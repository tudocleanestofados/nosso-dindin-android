
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { importPKCS8, SignJWT } from "npm:jose@5.9.6";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const secretKeysRaw = Deno.env.get("SUPABASE_SECRET_KEYS");
const ADMIN_KEY = secretKeysRaw
  ? JSON.parse(secretKeysRaw)["default"]
  : Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const supabase = createClient(SUPABASE_URL, ADMIN_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const FCM_SCOPE = "https://www.googleapis.com/auth/firebase.messaging";
const FCM_TOKEN_URL = "https://oauth2.googleapis.com/token";
const CHANNEL_ID = "nosso_dindin";

type Job = {
  id: string;
  group_id: string;
  actor_id: string | null;
  target_user_id: string | null;
  event_type: string;
  source_id: string | null;
  source_key: string;
  description: string | null;
  amount: number | string | null;
  account_name: string | null;
  balance_after: number | string | null;
  metadata: Record<string, unknown> | null;
  attempts: number;
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function money(value: unknown) {
  const n = Number(value || 0);
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(n);
}

function isoDateInBrazil() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const get = (t: string) => parts.find((x) => x.type === t)?.value || "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function addDays(iso: string, days: number) {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return dt.toISOString().slice(0, 10);
}

function formatDueDate(iso: unknown) {
  const s = String(iso || "");
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : s;
}

async function getAccessToken() {
  const raw = Deno.env.get("FIREBASE_SERVICE_ACCOUNT_JSON");
  if (!raw) throw new Error("FIREBASE_SERVICE_ACCOUNT_JSON não configurado");
  const sa = JSON.parse(raw);
  if (!sa.private_key || !sa.client_email || !sa.project_id) {
    throw new Error("Credencial Firebase incompleta");
  }
  const key = await importPKCS8(sa.private_key, "RS256");
  const now = Math.floor(Date.now() / 1000);
  const assertion = await new SignJWT({ scope: FCM_SCOPE })
    .setProtectedHeader({ alg: "RS256", typ: "JWT" })
    .setIssuer(sa.client_email)
    .setAudience(FCM_TOKEN_URL)
    .setIssuedAt(now)
    .setExpirationTime(now + 3600)
    .sign(key);

  const res = await fetch(FCM_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });
  const payload = await res.json();
  if (!res.ok || !payload.access_token) {
    throw new Error("Falha ao autenticar no Firebase: " + JSON.stringify(payload));
  }
  return { token: payload.access_token as string, projectId: sa.project_id as string };
}

async function actorName(actorId: string | null) {
  if (!actorId) return "Usuário";
  try {
    const { data } = await supabase.auth.admin.getUserById(actorId);
    const u = data?.user;
    const full = String(u?.user_metadata?.full_name || u?.user_metadata?.name || "").trim();
    if (full) return full;
    const email = String(u?.email || "");
    return email ? email.split("@")[0] : "Usuário";
  } catch {
    return "Usuário";
  }
}

async function availableBalance(groupId: string) {
  const [{ data: accounts }, { data: tx }, { data: gm }] = await Promise.all([
    supabase.from("accounts").select("initial_balance").eq("group_id", groupId),
    supabase.from("transactions").select("type,amount").eq("group_id", groupId).eq("paid", true),
    supabase.from("goal_movements").select("type,amount").eq("group_id", groupId),
  ]);
  const base = (accounts || []).reduce((s: number, a: any) => s + Number(a.initial_balance || 0), 0);
  const moved = (tx || []).reduce(
    (s: number, t: any) => s + (t.type === "income" ? Number(t.amount || 0) : -Number(t.amount || 0)),
    0,
  );
  const reserved = (gm || []).reduce(
    (s: number, x: any) => s + (x.type === "deposit" ? Number(x.amount || 0) : -Number(x.amount || 0)),
    0,
  );
  return base + moved - reserved;
}

async function statusMessage(userId: string, balance: number) {
  const { data } = await supabase
    .from("movement_alert_preferences")
    .select("low_balance_threshold,good_balance_threshold")
    .eq("user_id", userId)
    .maybeSingle();
  const low = Number(data?.low_balance_threshold ?? 200);
  const good = Number(data?.good_balance_threshold ?? 1600);
  if (balance < low) return `⚠️ Cuidado! Seu saldo está em ${money(balance)}.`;
  if (balance >= good) return `🎉 Parabéns! Seu saldo está em ${money(balance)}.`;
  return "";
}

async function transferDestination(job: Job) {
  const transferId = String(job.metadata?.transfer_id || "");
  if (!transferId) return "";
  const { data } = await supabase
    .from("transactions")
    .select("type,account_id,accounts(name)")
    .eq("transfer_id", transferId);
  const incoming = (data || []).find((x: any) => x.type === "income");
  return String((incoming as any)?.accounts?.name || "");
}

async function cardPurchaseDetails(job: Job) {
  const totalAmount = Number(job.amount || 0);
  let installments = Number(job.metadata?.installments || 0);
  let cardId = String(job.metadata?.card_id || "");
  let invoiceMonth = String(job.metadata?.invoice_month || "");

  if ((!installments || !invoiceMonth) && job.source_id) {
    const { data: purchase } = await supabase
      .from("card_purchases")
      .select("installments,card_id,purchase_date,credit_cards(closing_day)")
      .eq("id", job.source_id)
      .maybeSingle();

    if (purchase) {
      installments = Number((purchase as any).installments || installments || 1);
      cardId = String((purchase as any).card_id || cardId);

      if (!invoiceMonth) {
        const purchaseDate = String((purchase as any).purchase_date || "");
        const closingDay = Number((purchase as any).credit_cards?.closing_day || 31);
        const m = purchaseDate.match(/^(\d{4})-(\d{2})-(\d{2})$/);
        if (m) {
          const y = Number(m[1]);
          const mon = Number(m[2]);
          const day = Number(m[3]);
          const dt = day <= closingDay
            ? new Date(Date.UTC(y, mon - 1, 1))
            : new Date(Date.UTC(y, mon, 1));
          invoiceMonth = dt.toISOString().slice(0, 10);
        }
      }
    }
  }

  installments = installments || 1;

  // O push pode ser processado antes de as parcelas da nova compra terminarem
  // de ser gravadas. Para não depender dessa corrida, soma as parcelas já
  // existentes da fatura (excluindo a compra atual) e acrescenta diretamente
  // a primeira parcela da compra recém-criada.
  let existingInvoice = 0;
  if (cardId && invoiceMonth) {
    let q = supabase
      .from("card_installments")
      .select("amount,purchase_id")
      .eq("card_id", cardId)
      .eq("invoice_month", invoiceMonth)
      .eq("paid", false);

    if (job.source_id) q = q.neq("purchase_id", job.source_id);

    const { data: rows } = await q;
    existingInvoice = (rows || []).reduce(
      (sum: number, row: any) => sum + Number(row.amount || 0),
      0,
    );
  }

  const baseInstallment = installments > 1
    ? Math.floor((totalAmount / installments) * 100) / 100
    : totalAmount;

  return {
    installments,
    invoiceBalance: existingInvoice + baseInstallment,
  };
}

async function buildMessage(job: Job, targetUserId: string) {
  if (job.event_type === "gsc_daily") {
    return {
      title: "Gasto sem Culpa",
      body: job.description || "Confira o valor disponível para este mês.",
      data: { section: "gscSection", event_type: "gsc_daily" },
    };
  }
  if (job.event_type === "test") {
    return {
      title: "Nosso Dindin",
      body: "Notificações ativadas com sucesso neste aparelho.",
      data: { section: "notificationsSection", event_type: "test" },
    };
  }

  if (job.event_type.startsWith("due_")) {
    const days = Number(job.metadata?.days_before ?? 0);
    const title = days === 0 ? "Conta vence hoje" : days === 1 ? "Conta vence amanhã" : "Conta vence em 5 dias";
    return {
      title,
      body: `${job.description || "Conta"} • ${money(job.amount)}`,
      data: { section: "notificationsSection", event_type: job.event_type },
    };
  }

  const actor = await actorName(job.actor_id);
  const amount = money(job.amount);
  const balance = job.balance_after == null ? await availableBalance(job.group_id) : Number(job.balance_after);
  const balanceText = `Saldo atual: ${money(balance)}.`;
  const status = await statusMessage(targetUserId, balance);
  const balanceLine = status ? `\n${status}` : `\n${balanceText}`;

  if (job.event_type === "income_scheduled") {
    const due = formatDueDate(job.metadata?.due_date);
    return {
      title: "Receita a receber",
      body: `${actor} cadastrou ${amount} em ${job.description || "receita"}${due ? ` para receber em ${due}` : ""}.`,
      data: { section: "transactionsSection", event_type: job.event_type },
    };
  }

  if (job.event_type === "expense_scheduled") {
    const due = formatDueDate(job.metadata?.due_date);
    return {
      title: "Despesa com vencimento",
      body: `${actor} gastou ${amount} em ${job.description || "despesa"}${due ? ` com vencimento em ${due}` : ""}.`,
      data: { section: "transactionsSection", event_type: job.event_type },
    };
  }

  if (job.event_type === "income") {
    return {
      title: "Receita registrada",
      body: `${actor} adicionou ${amount} em ${job.description || "receita"}.${balanceLine}`,
      data: { section: "notificationsSection", event_type: job.event_type },
    };
  }

  if (job.event_type === "expense") {
    return {
      title: "Despesa registrada",
      body: `${actor} gastou ${amount} em ${job.description || "despesa"}.${balanceLine}`,
      data: { section: "notificationsSection", event_type: job.event_type },
    };
  }

  if (job.event_type === "transfer") {
    const to = await transferDestination(job);
    const from = job.account_name ? ` de ${job.account_name}` : "";
    const dest = to ? ` para ${to}` : "";
    return {
      title: "Transferência realizada",
      body: `${actor} transferiu ${amount}${from}${dest}.${balanceLine}`,
      data: { section: "accountsSection", event_type: job.event_type },
    };
  }

  if (job.event_type === "goal_deposit") {
    return {
      title: "Dinheiro guardado",
      body: `${actor} guardou ${amount} em ${job.description || "Cofrinho"}.${balanceLine}`,
      data: { section: "goalsSection", event_type: job.event_type },
    };
  }

  if (job.event_type === "goal_withdrawal") {
    return {
      title: "Dinheiro retirado",
      body: `${actor} retirou ${amount} de ${job.description || "Cofrinho"}.${balanceLine}`,
      data: { section: "goalsSection", event_type: job.event_type },
    };
  }

  if (job.event_type === "card_purchase") {
    const card = String(job.metadata?.card_name || "");
    const details = await cardPurchaseDetails(job);
    const installmentText = details.installments === 1
      ? "1 parcela"
      : `${details.installments} parcelas`;
    const invoiceText = details.invoiceBalance > 0
      ? ` Fatura atual: ${money(details.invoiceBalance)}.`
      : "";
    return {
      title: "Compra no cartão",
      body: `${actor} gastou ${amount} em ${job.description || "compra"}${card ? ` no cartão ${card}` : ""}. ${installmentText}.${invoiceText}`,
      data: { section: "cardsSection", event_type: job.event_type },
    };
  }

  return {
    title: "Nosso Dindin",
    body: `${actor} registrou uma movimentação de ${amount}.${balanceLine}`,
    data: { section: "notificationsSection", event_type: job.event_type },
  };
}

async function sendFcm(accessToken: string, projectId: string, token: string, msg: any, job: Job) {
  const res = await fetch(`https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      message: {
        token,
        notification: { title: msg.title, body: msg.body },
        android: {
          priority: "high",
          notification: {
            channel_id: CHANNEL_ID,
            sound: "default",
            default_vibrate_timings: true,
          },
        },
        data: {
          ...Object.fromEntries(Object.entries(msg.data || {}).map(([k, v]) => [k, String(v ?? "")])),
          job_id: job.id,
          group_id: job.group_id,
        },
      },
    }),
  });
  const body = await res.text();
  return { ok: res.ok, status: res.status, body };
}

async function enqueueDueJobs() {
  const today = isoDateInBrazil();
  const targets = [
    { days: 5, date: addDays(today, 5) },
    { days: 1, date: addDays(today, 1) },
    { days: 0, date: today },
  ];

  let created = 0;
  for (const target of targets) {
    const { data: tx, error } = await supabase
      .from("transactions")
      .select("id,group_id,description,amount,due_date")
      .eq("type", "expense")
      .eq("paid", false)
      .eq("due_date", target.date);
    if (error) throw error;

    for (const row of tx || []) {
      const { data: members } = await supabase
        .from("group_members")
        .select("user_id")
        .eq("group_id", row.group_id);
      for (const member of members || []) {
        const payload = {
          group_id: row.group_id,
          actor_id: null,
          target_user_id: member.user_id,
          event_type: `due_${target.days}`,
          source_id: row.id,
          source_key: `due:${row.id}:${target.days}:${member.user_id}`,
          description: row.description,
          amount: row.amount,
          metadata: { days_before: target.days, due_date: row.due_date },
        };
        const { error: insErr } = await supabase.from("push_jobs").insert(payload);
        if (!insErr) created++;
        else if (!String(insErr.code || "").includes("23505")) console.error("due insert", insErr);
      }
    }
  }
  return created;
}

async function processQueue() {
  const auth = await getAccessToken();
  const { data: jobs, error } = await supabase
    .from("push_jobs")
    .select("*")
    .is("sent_at", null)
    .lt("attempts", 10)
    .order("created_at", { ascending: true })
    .limit(50);
  if (error) throw error;

  let processed = 0;
  for (const job of (jobs || []) as Job[]) {
    let query = supabase
      .from("push_devices")
      .select("id,user_id,token")
      .eq("group_id", job.group_id)
      .eq("enabled", true);
    if (job.target_user_id) query = query.eq("user_id", job.target_user_id);
    const { data: devices, error: devErr } = await query;
    if (devErr) throw devErr;

    if (!devices?.length) {
      await supabase.from("push_jobs").update({
        sent_at: new Date().toISOString(),
        last_error: "Nenhum dispositivo registrado",
      }).eq("id", job.id);
      processed++;
      continue;
    }

    const { data: delivered } = await supabase
      .from("push_delivery_log")
      .select("device_id,status")
      .eq("job_id", job.id)
      .eq("status", "sent");
    const done = new Set((delivered || []).map((x: any) => x.device_id));
    let failures: string[] = [];

    for (const device of devices) {
      if (done.has(device.id)) continue;
      const msg = await buildMessage(job, device.user_id);
      const result = await sendFcm(auth.token, auth.projectId, device.token, msg, job);

      await supabase.from("push_delivery_log").upsert({
        job_id: job.id,
        device_id: device.id,
        status: result.ok ? "sent" : "error",
        sent_at: result.ok ? new Date().toISOString() : null,
        error: result.ok ? null : `${result.status}: ${result.body}`.slice(0, 1500),
      }, { onConflict: "job_id,device_id" });

      if (!result.ok) {
        failures.push(`${device.id}: ${result.status}`);
        if (result.status === 404 || result.body.includes("UNREGISTERED")) {
          await supabase.from("push_devices").update({ enabled: false }).eq("id", device.id);
        }
      }
    }

    if (!failures.length) {
      await supabase.from("push_jobs").update({
        sent_at: new Date().toISOString(),
        last_error: null,
      }).eq("id", job.id);
      processed++;
    } else {
      await supabase.from("push_jobs").update({
        attempts: Number(job.attempts || 0) + 1,
        last_error: failures.join("; "),
      }).eq("id", job.id);
    }
  }
  return processed;
}

Deno.serve(async (req: Request) => {
  try {
    if (!Deno.env.get("FIREBASE_SERVICE_ACCOUNT_JSON")) {
      return json({ ok: true, configured: false, message: "Firebase ainda não configurado" });
    }
    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const mode = String(body?.mode || "queue");
    if (mode === "due") {
      const created = await enqueueDueJobs();
      const processed = await processQueue();
      return json({ ok: true, mode, created, processed });
    }
    const processed = await processQueue();
    return json({ ok: true, mode: "queue", processed });
  } catch (error) {
    console.error(error);
    const safeError = error instanceof Error
      ? { name: error.name, message: error.message }
      : (typeof error === "object" && error !== null ? error : { message: String(error) });
    return json({ ok: false, error: safeError }, 500);
  }
});
