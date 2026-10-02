(() => {
  var __defProp = Object.defineProperty;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __esm = (fn, res) => function __init() {
    return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
  };
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };

  // node_modules/@capacitor/core/dist/index.js
  var ExceptionCode, CapacitorException, getPlatformId, createCapacitor, initCapacitorGlobal, Capacitor, registerPlugin, WebPlugin, encode, decode, CapacitorCookiesPluginWeb, CapacitorCookies, readBlobAsBase64, normalizeHttpHeaders, buildUrlParams, buildRequestInit, CapacitorHttpPluginWeb, CapacitorHttp, SystemBarsStyle, SystemBarType, SystemBarsPluginWeb, SystemBars;
  var init_dist = __esm({
    "node_modules/@capacitor/core/dist/index.js"() {
      (function(ExceptionCode2) {
        ExceptionCode2["Unimplemented"] = "UNIMPLEMENTED";
        ExceptionCode2["Unavailable"] = "UNAVAILABLE";
      })(ExceptionCode || (ExceptionCode = {}));
      CapacitorException = class extends Error {
        constructor(message, code, data) {
          super(message);
          this.message = message;
          this.code = code;
          this.data = data;
        }
      };
      getPlatformId = (win) => {
        var _a, _b;
        if (win === null || win === void 0 ? void 0 : win.androidBridge) {
          return "android";
        } else if ((_b = (_a = win === null || win === void 0 ? void 0 : win.webkit) === null || _a === void 0 ? void 0 : _a.messageHandlers) === null || _b === void 0 ? void 0 : _b.bridge) {
          return "ios";
        } else {
          return "web";
        }
      };
      createCapacitor = (win) => {
        const capCustomPlatform = win.CapacitorCustomPlatform || null;
        const cap = win.Capacitor || {};
        const Plugins = cap.Plugins = cap.Plugins || {};
        const getPlatform = () => {
          return capCustomPlatform !== null ? capCustomPlatform.name : getPlatformId(win);
        };
        const isNativePlatform = () => getPlatform() !== "web";
        const isPluginAvailable = (pluginName) => {
          const plugin = registeredPlugins.get(pluginName);
          if (plugin === null || plugin === void 0 ? void 0 : plugin.platforms.has(getPlatform())) {
            return true;
          }
          if (getPluginHeader(pluginName)) {
            return true;
          }
          return false;
        };
        const getPluginHeader = (pluginName) => {
          var _a;
          return (_a = cap.PluginHeaders) === null || _a === void 0 ? void 0 : _a.find((h) => h.name === pluginName);
        };
        const handleError = (err) => win.console.error(err);
        const registeredPlugins = /* @__PURE__ */ new Map();
        const registerPlugin2 = (pluginName, jsImplementations = {}) => {
          const registeredPlugin = registeredPlugins.get(pluginName);
          if (registeredPlugin) {
            console.warn(`Capacitor plugin "${pluginName}" already registered. Cannot register plugins twice.`);
            return registeredPlugin.proxy;
          }
          const platform = getPlatform();
          const pluginHeader = getPluginHeader(pluginName);
          let jsImplementation;
          const loadPluginImplementation = async () => {
            if (!jsImplementation && platform in jsImplementations) {
              jsImplementation = typeof jsImplementations[platform] === "function" ? jsImplementation = await jsImplementations[platform]() : jsImplementation = jsImplementations[platform];
            } else if (capCustomPlatform !== null && !jsImplementation && "web" in jsImplementations) {
              jsImplementation = typeof jsImplementations["web"] === "function" ? jsImplementation = await jsImplementations["web"]() : jsImplementation = jsImplementations["web"];
            }
            return jsImplementation;
          };
          const createPluginMethod = (impl, prop) => {
            var _a, _b;
            if (pluginHeader) {
              const methodHeader = pluginHeader === null || pluginHeader === void 0 ? void 0 : pluginHeader.methods.find((m) => prop === m.name);
              if (methodHeader) {
                if (methodHeader.rtype === "promise") {
                  return (options) => cap.nativePromise(pluginName, prop.toString(), options);
                } else {
                  return (options, callback) => cap.nativeCallback(pluginName, prop.toString(), options, callback);
                }
              } else if (impl) {
                return (_a = impl[prop]) === null || _a === void 0 ? void 0 : _a.bind(impl);
              }
            } else if (impl) {
              return (_b = impl[prop]) === null || _b === void 0 ? void 0 : _b.bind(impl);
            } else {
              throw new CapacitorException(`"${pluginName}" plugin is not implemented on ${platform}`, ExceptionCode.Unimplemented);
            }
          };
          const createPluginMethodWrapper = (prop) => {
            let remove;
            const wrapper = (...args) => {
              const p = loadPluginImplementation().then((impl) => {
                const fn = createPluginMethod(impl, prop);
                if (fn) {
                  const p2 = fn(...args);
                  remove = p2 === null || p2 === void 0 ? void 0 : p2.remove;
                  return p2;
                } else {
                  throw new CapacitorException(`"${pluginName}.${prop}()" is not implemented on ${platform}`, ExceptionCode.Unimplemented);
                }
              });
              if (prop === "addListener") {
                p.remove = async () => remove();
              }
              return p;
            };
            wrapper.toString = () => `${prop.toString()}() { [capacitor code] }`;
            Object.defineProperty(wrapper, "name", {
              value: prop,
              writable: false,
              configurable: false
            });
            return wrapper;
          };
          const addListener = createPluginMethodWrapper("addListener");
          const removeListener = createPluginMethodWrapper("removeListener");
          const addListenerNative = (eventName, callback) => {
            const call = addListener({ eventName }, callback);
            const remove = async () => {
              const callbackId = await call;
              removeListener({
                eventName,
                callbackId
              }, callback);
            };
            const p = new Promise((resolve) => call.then(() => resolve({ remove })));
            p.remove = async () => {
              console.warn(`Using addListener() without 'await' is deprecated.`);
              await remove();
            };
            return p;
          };
          const proxy = new Proxy({}, {
            get(_, prop) {
              switch (prop) {
                // https://github.com/facebook/react/issues/20030
                case "$$typeof":
                  return void 0;
                case "toJSON":
                  return () => ({});
                case "addListener":
                  return pluginHeader ? addListenerNative : addListener;
                case "removeListener":
                  return removeListener;
                default:
                  return createPluginMethodWrapper(prop);
              }
            }
          });
          Plugins[pluginName] = proxy;
          registeredPlugins.set(pluginName, {
            name: pluginName,
            proxy,
            platforms: /* @__PURE__ */ new Set([...Object.keys(jsImplementations), ...pluginHeader ? [platform] : []])
          });
          return proxy;
        };
        if (!cap.convertFileSrc) {
          cap.convertFileSrc = (filePath) => filePath;
        }
        cap.getPlatform = getPlatform;
        cap.handleError = handleError;
        cap.isNativePlatform = isNativePlatform;
        cap.isPluginAvailable = isPluginAvailable;
        cap.registerPlugin = registerPlugin2;
        cap.Exception = CapacitorException;
        cap.DEBUG = !!cap.DEBUG;
        cap.isLoggingEnabled = !!cap.isLoggingEnabled;
        return cap;
      };
      initCapacitorGlobal = (win) => win.Capacitor = createCapacitor(win);
      Capacitor = /* @__PURE__ */ initCapacitorGlobal(typeof globalThis !== "undefined" ? globalThis : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : typeof global !== "undefined" ? global : {});
      registerPlugin = Capacitor.registerPlugin;
      WebPlugin = class {
        constructor() {
          this.listeners = {};
          this.retainedEventArguments = {};
          this.windowListeners = {};
        }
        addListener(eventName, listenerFunc) {
          let firstListener = false;
          const listeners = this.listeners[eventName];
          if (!listeners) {
            this.listeners[eventName] = [];
            firstListener = true;
          }
          this.listeners[eventName].push(listenerFunc);
          const windowListener = this.windowListeners[eventName];
          if (windowListener && !windowListener.registered) {
            this.addWindowListener(windowListener);
          }
          if (firstListener) {
            this.sendRetainedArgumentsForEvent(eventName);
          }
          const remove = async () => this.removeListener(eventName, listenerFunc);
          const p = Promise.resolve({ remove });
          return p;
        }
        async removeAllListeners() {
          this.listeners = {};
          for (const listener in this.windowListeners) {
            this.removeWindowListener(this.windowListeners[listener]);
          }
          this.windowListeners = {};
        }
        notifyListeners(eventName, data, retainUntilConsumed) {
          const listeners = this.listeners[eventName];
          if (!listeners) {
            if (retainUntilConsumed) {
              let args = this.retainedEventArguments[eventName];
              if (!args) {
                args = [];
              }
              args.push(data);
              this.retainedEventArguments[eventName] = args;
            }
            return;
          }
          listeners.forEach((listener) => listener(data));
        }
        hasListeners(eventName) {
          var _a;
          return !!((_a = this.listeners[eventName]) === null || _a === void 0 ? void 0 : _a.length);
        }
        registerWindowListener(windowEventName, pluginEventName) {
          this.windowListeners[pluginEventName] = {
            registered: false,
            windowEventName,
            pluginEventName,
            handler: (event) => {
              this.notifyListeners(pluginEventName, event);
            }
          };
        }
        unimplemented(msg = "not implemented") {
          return new Capacitor.Exception(msg, ExceptionCode.Unimplemented);
        }
        unavailable(msg = "not available") {
          return new Capacitor.Exception(msg, ExceptionCode.Unavailable);
        }
        async removeListener(eventName, listenerFunc) {
          const listeners = this.listeners[eventName];
          if (!listeners) {
            return;
          }
          const index = listeners.indexOf(listenerFunc);
          this.listeners[eventName].splice(index, 1);
          if (!this.listeners[eventName].length) {
            this.removeWindowListener(this.windowListeners[eventName]);
          }
        }
        addWindowListener(handle) {
          window.addEventListener(handle.windowEventName, handle.handler);
          handle.registered = true;
        }
        removeWindowListener(handle) {
          if (!handle) {
            return;
          }
          window.removeEventListener(handle.windowEventName, handle.handler);
          handle.registered = false;
        }
        sendRetainedArgumentsForEvent(eventName) {
          const args = this.retainedEventArguments[eventName];
          if (!args) {
            return;
          }
          delete this.retainedEventArguments[eventName];
          args.forEach((arg) => {
            this.notifyListeners(eventName, arg);
          });
        }
      };
      encode = (str) => encodeURIComponent(str).replace(/%(2[346B]|5E|60|7C)/g, decodeURIComponent).replace(/[()]/g, escape);
      decode = (str) => str.replace(/(%[\dA-F]{2})+/gi, decodeURIComponent);
      CapacitorCookiesPluginWeb = class extends WebPlugin {
        async getCookies() {
          const cookies = document.cookie;
          const cookieMap = {};
          cookies.split(";").forEach((cookie) => {
            if (cookie.length <= 0)
              return;
            let [key, value] = cookie.replace(/=/, "CAP_COOKIE").split("CAP_COOKIE");
            key = decode(key).trim();
            value = decode(value).trim();
            cookieMap[key] = value;
          });
          return cookieMap;
        }
        async setCookie(options) {
          try {
            const encodedKey = encode(options.key);
            const encodedValue = encode(options.value);
            const expires = `; expires=${(options.expires || "").replace("expires=", "")}`;
            const path = (options.path || "/").replace("path=", "");
            const domain = options.url != null && options.url.length > 0 ? `domain=${options.url}` : "";
            document.cookie = `${encodedKey}=${encodedValue || ""}${expires}; path=${path}; ${domain};`;
          } catch (error) {
            return Promise.reject(error);
          }
        }
        async deleteCookie(options) {
          try {
            document.cookie = `${options.key}=; Max-Age=0`;
          } catch (error) {
            return Promise.reject(error);
          }
        }
        async clearCookies() {
          try {
            const cookies = document.cookie.split(";") || [];
            for (const cookie of cookies) {
              document.cookie = cookie.replace(/^ +/, "").replace(/=.*/, `=;expires=${(/* @__PURE__ */ new Date()).toUTCString()};path=/`);
            }
          } catch (error) {
            return Promise.reject(error);
          }
        }
        async clearAllCookies() {
          try {
            await this.clearCookies();
          } catch (error) {
            return Promise.reject(error);
          }
        }
      };
      CapacitorCookies = registerPlugin("CapacitorCookies", {
        web: () => new CapacitorCookiesPluginWeb()
      });
      readBlobAsBase64 = async (blob) => new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          const base64String = reader.result;
          resolve(base64String.indexOf(",") >= 0 ? base64String.split(",")[1] : base64String);
        };
        reader.onerror = (error) => reject(error);
        reader.readAsDataURL(blob);
      });
      normalizeHttpHeaders = (headers = {}) => {
        const originalKeys = Object.keys(headers);
        const loweredKeys = Object.keys(headers).map((k) => k.toLocaleLowerCase());
        const normalized = loweredKeys.reduce((acc, key, index) => {
          acc[key] = headers[originalKeys[index]];
          return acc;
        }, {});
        return normalized;
      };
      buildUrlParams = (params, shouldEncode = true) => {
        if (!params)
          return null;
        const output = Object.entries(params).reduce((accumulator, entry) => {
          const [key, value] = entry;
          let encodedValue;
          let item;
          if (Array.isArray(value)) {
            item = "";
            value.forEach((str) => {
              encodedValue = shouldEncode ? encodeURIComponent(str) : str;
              item += `${key}=${encodedValue}&`;
            });
            item.slice(0, -1);
          } else {
            encodedValue = shouldEncode ? encodeURIComponent(value) : value;
            item = `${key}=${encodedValue}`;
          }
          return `${accumulator}&${item}`;
        }, "");
        return output.substr(1);
      };
      buildRequestInit = (options, extra = {}) => {
        const output = Object.assign({ method: options.method || "GET", headers: options.headers }, extra);
        const headers = normalizeHttpHeaders(options.headers);
        const type = headers["content-type"] || "";
        if (typeof options.data === "string") {
          output.body = options.data;
        } else if (type.includes("application/x-www-form-urlencoded")) {
          const params = new URLSearchParams();
          for (const [key, value] of Object.entries(options.data || {})) {
            params.set(key, value);
          }
          output.body = params.toString();
        } else if (type.includes("multipart/form-data") || options.data instanceof FormData) {
          const form = new FormData();
          if (options.data instanceof FormData) {
            options.data.forEach((value, key) => {
              form.append(key, value);
            });
          } else {
            for (const key of Object.keys(options.data)) {
              form.append(key, options.data[key]);
            }
          }
          output.body = form;
          const headers2 = new Headers(output.headers);
          headers2.delete("content-type");
          output.headers = headers2;
        } else if (type.includes("application/json") || typeof options.data === "object") {
          output.body = JSON.stringify(options.data);
        }
        return output;
      };
      CapacitorHttpPluginWeb = class extends WebPlugin {
        /**
         * Perform an Http request given a set of options
         * @param options Options to build the HTTP request
         */
        async request(options) {
          const requestInit = buildRequestInit(options, options.webFetchExtra);
          const urlParams = buildUrlParams(options.params, options.shouldEncodeUrlParams);
          const url = urlParams ? `${options.url}?${urlParams}` : options.url;
          const response = await fetch(url, requestInit);
          const contentType = response.headers.get("content-type") || "";
          let { responseType = "text" } = response.ok ? options : {};
          if (contentType.includes("application/json")) {
            responseType = "json";
          }
          let data;
          let blob;
          switch (responseType) {
            case "arraybuffer":
            case "blob":
              blob = await response.blob();
              data = await readBlobAsBase64(blob);
              break;
            case "json":
              data = await response.json();
              break;
            case "document":
            case "text":
            default:
              data = await response.text();
          }
          const headers = {};
          response.headers.forEach((value, key) => {
            headers[key] = value;
          });
          return {
            data,
            headers,
            status: response.status,
            url: response.url
          };
        }
        /**
         * Perform an Http GET request given a set of options
         * @param options Options to build the HTTP request
         */
        async get(options) {
          return this.request(Object.assign(Object.assign({}, options), { method: "GET" }));
        }
        /**
         * Perform an Http POST request given a set of options
         * @param options Options to build the HTTP request
         */
        async post(options) {
          return this.request(Object.assign(Object.assign({}, options), { method: "POST" }));
        }
        /**
         * Perform an Http PUT request given a set of options
         * @param options Options to build the HTTP request
         */
        async put(options) {
          return this.request(Object.assign(Object.assign({}, options), { method: "PUT" }));
        }
        /**
         * Perform an Http PATCH request given a set of options
         * @param options Options to build the HTTP request
         */
        async patch(options) {
          return this.request(Object.assign(Object.assign({}, options), { method: "PATCH" }));
        }
        /**
         * Perform an Http DELETE request given a set of options
         * @param options Options to build the HTTP request
         */
        async delete(options) {
          return this.request(Object.assign(Object.assign({}, options), { method: "DELETE" }));
        }
      };
      CapacitorHttp = registerPlugin("CapacitorHttp", {
        web: () => new CapacitorHttpPluginWeb()
      });
      (function(SystemBarsStyle2) {
        SystemBarsStyle2["Dark"] = "DARK";
        SystemBarsStyle2["Light"] = "LIGHT";
        SystemBarsStyle2["Default"] = "DEFAULT";
      })(SystemBarsStyle || (SystemBarsStyle = {}));
      (function(SystemBarType2) {
        SystemBarType2["StatusBar"] = "StatusBar";
        SystemBarType2["NavigationBar"] = "NavigationBar";
      })(SystemBarType || (SystemBarType = {}));
      SystemBarsPluginWeb = class extends WebPlugin {
        async setStyle() {
          this.unavailable("not available for web");
        }
        async setAnimation() {
          this.unavailable("not available for web");
        }
        async show() {
          this.unavailable("not available for web");
        }
        async hide() {
          this.unavailable("not available for web");
        }
      };
      SystemBars = registerPlugin("SystemBars", {
        web: () => new SystemBarsPluginWeb()
      });
    }
  });

  // node_modules/@capgo/capacitor-updater/dist/esm/definitions.js
  var AppUpdateAvailability, FlexibleUpdateInstallStatus, AppUpdateResultCode;
  var init_definitions = __esm({
    "node_modules/@capgo/capacitor-updater/dist/esm/definitions.js"() {
      (function(AppUpdateAvailability2) {
        AppUpdateAvailability2[AppUpdateAvailability2["UNKNOWN"] = 0] = "UNKNOWN";
        AppUpdateAvailability2[AppUpdateAvailability2["UPDATE_NOT_AVAILABLE"] = 1] = "UPDATE_NOT_AVAILABLE";
        AppUpdateAvailability2[AppUpdateAvailability2["UPDATE_AVAILABLE"] = 2] = "UPDATE_AVAILABLE";
        AppUpdateAvailability2[AppUpdateAvailability2["UPDATE_IN_PROGRESS"] = 3] = "UPDATE_IN_PROGRESS";
      })(AppUpdateAvailability || (AppUpdateAvailability = {}));
      (function(FlexibleUpdateInstallStatus2) {
        FlexibleUpdateInstallStatus2[FlexibleUpdateInstallStatus2["UNKNOWN"] = 0] = "UNKNOWN";
        FlexibleUpdateInstallStatus2[FlexibleUpdateInstallStatus2["PENDING"] = 1] = "PENDING";
        FlexibleUpdateInstallStatus2[FlexibleUpdateInstallStatus2["DOWNLOADING"] = 2] = "DOWNLOADING";
        FlexibleUpdateInstallStatus2[FlexibleUpdateInstallStatus2["INSTALLING"] = 3] = "INSTALLING";
        FlexibleUpdateInstallStatus2[FlexibleUpdateInstallStatus2["INSTALLED"] = 4] = "INSTALLED";
        FlexibleUpdateInstallStatus2[FlexibleUpdateInstallStatus2["FAILED"] = 5] = "FAILED";
        FlexibleUpdateInstallStatus2[FlexibleUpdateInstallStatus2["CANCELED"] = 6] = "CANCELED";
        FlexibleUpdateInstallStatus2[FlexibleUpdateInstallStatus2["DOWNLOADED"] = 11] = "DOWNLOADED";
      })(FlexibleUpdateInstallStatus || (FlexibleUpdateInstallStatus = {}));
      (function(AppUpdateResultCode2) {
        AppUpdateResultCode2[AppUpdateResultCode2["OK"] = 0] = "OK";
        AppUpdateResultCode2[AppUpdateResultCode2["CANCELED"] = 1] = "CANCELED";
        AppUpdateResultCode2[AppUpdateResultCode2["FAILED"] = 2] = "FAILED";
        AppUpdateResultCode2[AppUpdateResultCode2["NOT_AVAILABLE"] = 3] = "NOT_AVAILABLE";
        AppUpdateResultCode2[AppUpdateResultCode2["NOT_ALLOWED"] = 4] = "NOT_ALLOWED";
        AppUpdateResultCode2[AppUpdateResultCode2["INFO_MISSING"] = 5] = "INFO_MISSING";
      })(AppUpdateResultCode || (AppUpdateResultCode = {}));
    }
  });

  // node_modules/@capgo/capacitor-updater/dist/esm/web.js
  var web_exports = {};
  __export(web_exports, {
    CapacitorUpdaterWeb: () => CapacitorUpdaterWeb
  });
  var BUNDLE_BUILTIN, CapacitorUpdaterWeb;
  var init_web = __esm({
    "node_modules/@capgo/capacitor-updater/dist/esm/web.js"() {
      init_dist();
      init_definitions();
      BUNDLE_BUILTIN = {
        status: "success",
        version: "",
        downloaded: "1970-01-01T00:00:00.000Z",
        id: "builtin",
        checksum: ""
      };
      CapacitorUpdaterWeb = class extends WebPlugin {
        async setStatsUrl(options) {
          console.warn("Cannot setStatsUrl in web", options);
          return;
        }
        async setUpdateUrl(options) {
          console.warn("Cannot setUpdateUrl in web", options);
          return;
        }
        async setChannelUrl(options) {
          console.warn("Cannot setChannelUrl in web", options);
          return;
        }
        async download(options) {
          console.warn("Cannot download version in web", options);
          return BUNDLE_BUILTIN;
        }
        async next(options) {
          console.warn("Cannot set next version in web", options);
          return BUNDLE_BUILTIN;
        }
        async isAutoUpdateEnabled() {
          console.warn("Cannot get isAutoUpdateEnabled in web");
          return { enabled: false };
        }
        async set(options) {
          console.warn("Cannot set active bundle in web", options);
          return;
        }
        async startPreviewSession(options) {
          console.warn("Cannot start preview session in web", options);
          return;
        }
        async listPreviews() {
          console.warn("Cannot list previews in web");
          return { previews: [], currentBundle: BUNDLE_BUILTIN };
        }
        async setPreview(options) {
          console.warn("Cannot set preview in web", options);
          return;
        }
        async resetPreview() {
          console.warn("Cannot reset preview in web");
          return;
        }
        async deletePreview(options) {
          console.warn("Cannot delete preview in web", options);
          return { removed: false, deleted: false };
        }
        async checkPreviewUpdate(options) {
          console.warn("Cannot check preview update in web", options);
          throw this.unimplemented("Preview updates are not available on web platform");
        }
        async updatePreview(options) {
          console.warn("Cannot update preview in web", options);
          throw this.unimplemented("Preview updates are not available on web platform");
        }
        async getDeviceId() {
          console.warn("Cannot get ID in web");
          return { deviceId: "default" };
        }
        async getBuiltinVersion() {
          console.warn("Cannot get version in web");
          return { version: "default" };
        }
        async getPluginVersion() {
          console.warn("Cannot get plugin version in web");
          return { version: "default" };
        }
        async delete(options) {
          console.warn("Cannot delete bundle in web", options);
        }
        async setBundleError(options) {
          console.warn("Cannot setBundleError in web", options);
          return BUNDLE_BUILTIN;
        }
        async list() {
          console.warn("Cannot list bundles in web");
          return { bundles: [] };
        }
        async reset(options) {
          console.warn("Cannot reset version in web", options);
        }
        async current() {
          console.warn("Cannot get current bundle in web");
          return { bundle: BUNDLE_BUILTIN, native: "0.0.0" };
        }
        async reload() {
          console.warn("Cannot reload current bundle in web");
          return;
        }
        async getLatest() {
          console.warn("Cannot getLatest current bundle in web");
          return {
            version: "0.0.0",
            message: "Cannot getLatest current bundle in web"
          };
        }
        async triggerUpdateCheck() {
          console.warn("Cannot triggerUpdateCheck in web");
          return { status: "unavailable", queued: false };
        }
        async getMissingBundleFiles(options) {
          var _a, _b, _c;
          console.warn("Cannot inspect missing bundle files in web", { manifestLength: (_b = (_a = options.manifest) === null || _a === void 0 ? void 0 : _a.length) !== null && _b !== void 0 ? _b : 0 });
          const missing = (_c = options.manifest) !== null && _c !== void 0 ? _c : [];
          return {
            missing,
            total: missing.length,
            missingCount: missing.length,
            reusableCount: 0
          };
        }
        async getBundleDownloadSize(options) {
          var _a, _b, _c, _d, _e;
          console.warn("Cannot estimate bundle download size in web", { manifestLength: (_b = (_a = options.manifest) === null || _a === void 0 ? void 0 : _a.length) !== null && _b !== void 0 ? _b : 0 });
          return {
            totalSize: 0,
            knownFiles: 0,
            unknownFiles: (_d = (_c = options.manifest) === null || _c === void 0 ? void 0 : _c.length) !== null && _d !== void 0 ? _d : 0,
            files: ((_e = options.manifest) !== null && _e !== void 0 ? _e : []).map((entry) => ({
              file_name: entry.file_name,
              file_hash: entry.file_hash,
              download_url: entry.download_url,
              error: "unavailable"
            }))
          };
        }
        async setChannel(options) {
          console.warn("Cannot setChannel in web", options);
          return {
            status: "error",
            error: "Cannot setChannel in web"
          };
        }
        async unsetChannel(options) {
          console.warn("Cannot unsetChannel in web", options);
          return;
        }
        async setCustomId(options) {
          console.warn("Cannot setCustomId in web", options);
          return;
        }
        async getChannel() {
          console.warn("Cannot getChannel in web");
          return {
            status: "error",
            error: "Cannot getChannel in web"
          };
        }
        async listChannels() {
          console.warn("Cannot listChannels in web");
          throw {
            message: "Cannot listChannels in web",
            error: "platform_not_supported"
          };
        }
        async notifyAppReady() {
          return { bundle: BUNDLE_BUILTIN };
        }
        async setMultiDelay(options) {
          console.warn("Cannot setMultiDelay in web", options === null || options === void 0 ? void 0 : options.delayConditions);
          return;
        }
        async cancelDelay() {
          console.warn("Cannot cancelDelay in web");
          return;
        }
        async isAutoUpdateAvailable() {
          console.warn("Cannot isAutoUpdateAvailable in web");
          return { available: false };
        }
        async getCurrentBundle() {
          console.warn("Cannot get current bundle in web");
          return BUNDLE_BUILTIN;
        }
        async getNextBundle() {
          return Promise.resolve(null);
        }
        async getFailedUpdate() {
          console.warn("Cannot getFailedUpdate in web");
          return null;
        }
        async setShakeMenu(_options) {
          throw this.unimplemented("Shake menu not available on web platform");
        }
        async isShakeMenuEnabled() {
          return Promise.resolve({ enabled: false, gesture: "shake" });
        }
        async setShakeChannelSelector(_options) {
          throw this.unimplemented("Shake channel selector not available on web platform");
        }
        async isShakeChannelSelectorEnabled() {
          return Promise.resolve({ enabled: false });
        }
        async getAppId() {
          console.warn("Cannot getAppId in web");
          return { appId: "default" };
        }
        async setAppId(options) {
          console.warn("Cannot setAppId in web", options);
          return;
        }
        // ============================================================================
        // App Store / Play Store Update Methods (Web stubs)
        // ============================================================================
        async getAppUpdateInfo(_options) {
          console.warn("getAppUpdateInfo is not available on web platform");
          return {
            currentVersionName: "0.0.0",
            currentVersionCode: "0",
            updateAvailability: AppUpdateAvailability.UNKNOWN
          };
        }
        async openAppStore(_options) {
          throw this.unimplemented("openAppStore is not available on web platform");
        }
        async performImmediateUpdate() {
          throw this.unimplemented("performImmediateUpdate is only available on Android");
        }
        async startFlexibleUpdate() {
          throw this.unimplemented("startFlexibleUpdate is only available on Android");
        }
        async completeFlexibleUpdate() {
          throw this.unimplemented("completeFlexibleUpdate is only available on Android");
        }
      };
    }
  });

  // node_modules/@capgo/capacitor-updater/dist/esm/index.js
  init_dist();

  // node_modules/@capgo/capacitor-updater/dist/esm/history.js
  var KEEP_FLAG_KEY = "__capgo_keep_url_path_after_reload";
  var HISTORY_STORAGE_KEY = "__capgo_history_stack__";
  var MAX_STACK_ENTRIES = 100;
  var isBrowser = typeof window !== "undefined" && typeof document !== "undefined" && typeof history !== "undefined";
  if (isBrowser) {
    const win = window;
    if (!win.__capgoHistoryPatched) {
      win.__capgoHistoryPatched = true;
      const isFeatureConfigured = () => {
        try {
          if (win.__capgoKeepUrlPathAfterReload) {
            return true;
          }
        } catch (err) {
        }
        try {
          return window.localStorage.getItem(KEEP_FLAG_KEY) === "1";
        } catch (err) {
          return false;
        }
      };
      const readStored = () => {
        try {
          const raw = window.sessionStorage.getItem(HISTORY_STORAGE_KEY);
          if (!raw) {
            return { stack: [], index: -1 };
          }
          const parsed = JSON.parse(raw);
          if (!parsed || !Array.isArray(parsed.stack) || typeof parsed.index !== "number") {
            return { stack: [], index: -1 };
          }
          return parsed;
        } catch (err) {
          return { stack: [], index: -1 };
        }
      };
      const writeStored = (stack, index) => {
        try {
          window.sessionStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify({ stack, index }));
        } catch (err) {
        }
      };
      const clearStored = () => {
        try {
          window.sessionStorage.removeItem(HISTORY_STORAGE_KEY);
        } catch (err) {
        }
      };
      const normalize = (url) => {
        try {
          const base = url !== null && url !== void 0 ? url : window.location.href;
          const parsed = new URL(base instanceof URL ? base.toString() : base, window.location.href);
          return `${parsed.pathname}${parsed.search}${parsed.hash}`;
        } catch (err) {
          return null;
        }
      };
      const trimStack = (stack, index) => {
        if (stack.length <= MAX_STACK_ENTRIES) {
          return { stack, index };
        }
        const start = stack.length - MAX_STACK_ENTRIES;
        const trimmed = stack.slice(start);
        const adjustedIndex = Math.max(0, index - start);
        return { stack: trimmed, index: adjustedIndex };
      };
      const runWhenReady = (fn) => {
        if (document.readyState === "complete" || document.readyState === "interactive") {
          fn();
        } else {
          window.addEventListener("DOMContentLoaded", fn, { once: true });
        }
      };
      let featureActive = false;
      let isRestoring = false;
      let restoreScheduled = false;
      const ensureCurrentTracked = () => {
        if (!featureActive) {
          return;
        }
        const stored = readStored();
        const current = normalize();
        if (!current) {
          return;
        }
        if (stored.stack.length === 0) {
          stored.stack.push(current);
          stored.index = 0;
          writeStored(stored.stack, stored.index);
          return;
        }
        if (stored.index < 0 || stored.index >= stored.stack.length) {
          stored.index = stored.stack.length - 1;
        }
        if (stored.stack[stored.index] !== current) {
          stored.stack[stored.index] = current;
          writeStored(stored.stack, stored.index);
        }
      };
      const record = (url, replace) => {
        if (!featureActive || isRestoring) {
          return;
        }
        const normalized = normalize(url);
        if (!normalized) {
          return;
        }
        let { stack, index } = readStored();
        if (stack.length === 0) {
          stack.push(normalized);
          index = stack.length - 1;
        } else if (replace) {
          if (index < 0 || index >= stack.length) {
            index = stack.length - 1;
          }
          stack[index] = normalized;
        } else {
          if (index >= stack.length - 1) {
            stack.push(normalized);
            index = stack.length - 1;
          } else {
            stack = stack.slice(0, index + 1);
            stack.push(normalized);
            index = stack.length - 1;
          }
        }
        ({ stack, index } = trimStack(stack, index));
        writeStored(stack, index);
      };
      const restoreHistory = () => {
        if (!featureActive || isRestoring) {
          return;
        }
        const stored = readStored();
        if (stored.stack.length === 0) {
          ensureCurrentTracked();
          return;
        }
        const targetIndex = stored.index >= 0 && stored.index < stored.stack.length ? stored.index : stored.stack.length - 1;
        const normalizedCurrent = normalize();
        if (stored.stack.length === 1 && normalizedCurrent === stored.stack[0]) {
          return;
        }
        const firstEntry = stored.stack[0];
        if (!firstEntry) {
          return;
        }
        isRestoring = true;
        try {
          history.replaceState(history.state, document.title, firstEntry);
          for (let i = 1; i < stored.stack.length; i += 1) {
            history.pushState(history.state, document.title, stored.stack[i]);
          }
        } catch (err) {
          isRestoring = false;
          return;
        }
        isRestoring = false;
        const currentIndex = stored.stack.length - 1;
        const offset = targetIndex - currentIndex;
        if (offset !== 0) {
          history.go(offset);
        } else {
          history.replaceState(history.state, document.title, stored.stack[targetIndex]);
          window.dispatchEvent(new PopStateEvent("popstate"));
        }
      };
      const scheduleRestore = () => {
        if (!featureActive || restoreScheduled) {
          return;
        }
        restoreScheduled = true;
        runWhenReady(() => {
          restoreScheduled = false;
          restoreHistory();
        });
      };
      let originalPushState = null;
      let originalReplaceState = null;
      const popstateHandler = () => {
        if (!featureActive || isRestoring) {
          return;
        }
        const normalized = normalize();
        if (!normalized) {
          return;
        }
        const stored = readStored();
        const idx = stored.stack.lastIndexOf(normalized);
        if (idx >= 0) {
          stored.index = idx;
        } else {
          stored.stack.push(normalized);
          stored.index = stored.stack.length - 1;
        }
        const trimmed = trimStack(stored.stack, stored.index);
        writeStored(trimmed.stack, trimmed.index);
      };
      const patchHistory = () => {
        if (originalPushState && originalReplaceState) {
          return;
        }
        originalPushState = history.pushState;
        originalReplaceState = history.replaceState;
        history.pushState = function pushStatePatched(state2, title, url) {
          const result = originalPushState === null || originalPushState === void 0 ? void 0 : originalPushState.call(history, state2, title, url);
          record(url, false);
          return result;
        };
        history.replaceState = function replaceStatePatched(state2, title, url) {
          const result = originalReplaceState === null || originalReplaceState === void 0 ? void 0 : originalReplaceState.call(history, state2, title, url);
          record(url, true);
          return result;
        };
        window.addEventListener("popstate", popstateHandler);
      };
      const unpatchHistory = () => {
        if (originalPushState) {
          history.pushState = originalPushState;
          originalPushState = null;
        }
        if (originalReplaceState) {
          history.replaceState = originalReplaceState;
          originalReplaceState = null;
        }
        window.removeEventListener("popstate", popstateHandler);
      };
      const setFeatureActive = (enabled) => {
        if (featureActive === enabled) {
          if (featureActive) {
            ensureCurrentTracked();
            scheduleRestore();
          }
          return;
        }
        featureActive = enabled;
        if (featureActive) {
          patchHistory();
          ensureCurrentTracked();
          scheduleRestore();
        } else {
          unpatchHistory();
          clearStored();
        }
      };
      window.addEventListener("CapacitorUpdaterKeepUrlPathAfterReload", (event) => {
        var _a;
        const evt = event;
        const enabled = (_a = evt === null || evt === void 0 ? void 0 : evt.detail) === null || _a === void 0 ? void 0 : _a.enabled;
        if (typeof enabled === "boolean") {
          win.__capgoKeepUrlPathAfterReload = enabled;
          setFeatureActive(enabled);
        } else {
          win.__capgoKeepUrlPathAfterReload = true;
          setFeatureActive(true);
        }
      });
      setFeatureActive(isFeatureConfigured());
    }
  }

  // node_modules/@capgo/capacitor-updater/dist/esm/index.js
  init_definitions();
  var CapacitorUpdater = registerPlugin("CapacitorUpdater", {
    web: () => Promise.resolve().then(() => (init_web(), web_exports)).then((m) => new m.CapacitorUpdaterWeb())
  });

  // update-native-entry.js
  var STATUS = () => document.getElementById("ndUpdateStatus");
  var manifestUrl = "https://raw.githubusercontent.com/tudocleanestofados/nosso-dindin-android/main/updates/manifest.json";
  var state = { checking: false };
  async function checkUpdates(manual = false) {
    if (state.checking) return;
    state.checking = true;
    try {
      const current = await CapacitorUpdater.current();
      const webVersion = current.bundle.version;
      const nativeVersion = current.native;
      STATUS().textContent = `Vers\xE3o instalada: ${nativeVersion} \xB7 conte\xFAdo: ${webVersion}`;
      const response = await fetch(manifestUrl + "?t=" + Date.now(), { cache: "no-store" });
      if (!response.ok) throw new Error("N\xE3o foi poss\xEDvel consultar as vers\xF5es.");
      const manifest = await response.json();
      if (manifest.app_id !== "com.nossodindin.app") throw new Error("Manifesto de outro aplicativo.");
      if (manifest.native_version && manifest.native_version !== nativeVersion && manifest.apk_url) {
        STATUS().textContent = `Nova vers\xE3o do aplicativo: ${manifest.native_version}.`;
        if (manual && confirm("H\xE1 uma vers\xE3o nova do aplicativo. Abrir a instala\xE7\xE3o?")) window.open(manifest.apk_url, "_system");
        return;
      }
      if (!manifest.web_version || manifest.web_version === webVersion || !manifest.zip_url) {
        if (manual) STATUS().textContent = `Vers\xE3o instalada: ${nativeVersion} \xB7 conte\xFAdo: ${webVersion}. Atualizado.`;
        return;
      }
      if (!/^https:\/\//.test(manifest.zip_url) || !/^[a-f0-9]{64}$/i.test(manifest.sha256)) throw new Error("Pacote de atualiza\xE7\xE3o inv\xE1lido.");
      STATUS().textContent = "Baixando atualiza\xE7\xE3o do conte\xFAdo\u2026";
      const bundle = await CapacitorUpdater.download({ version: manifest.web_version, url: manifest.zip_url, checksum: manifest.sha256 });
      STATUS().textContent = "Atualiza\xE7\xE3o pronta. Abrindo a nova vers\xE3o\u2026";
      await CapacitorUpdater.set({ id: bundle.id });
    } catch (error) {
      console.error("Atualiza\xE7\xE3o:", error);
      if (manual) STATUS().textContent = error.message || "N\xE3o foi poss\xEDvel verificar atualiza\xE7\xF5es.";
    } finally {
      state.checking = false;
    }
  }
  window.ndCheckUpdates = checkUpdates;
  CapacitorUpdater.notifyAppReady().then(() => checkUpdates(false)).catch((error) => console.error("Atualiza\xE7\xE3o:", error));
})();
/*! Bundled license information:

@capacitor/core/dist/index.js:
  (*! Capacitor: https://capacitorjs.com/ - MIT License *)
*/
