var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });
var __publicField = (obj, key, value) => {
  __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);
  return value;
};

// node_modules/jose/dist/webapi/lib/buffer_utils.js
var encoder = new TextEncoder();
var decoder = new TextDecoder();
var MAX_INT32 = 2 ** 32;
function concat(...buffers) {
  const size2 = buffers.reduce((acc, { length }) => acc + length, 0);
  const buf = new Uint8Array(size2);
  let i = 0;
  for (const buffer of buffers) {
    buf.set(buffer, i);
    i += buffer.length;
  }
  return buf;
}
__name(concat, "concat");
function encode(string) {
  const bytes = new Uint8Array(string.length);
  for (let i = 0; i < string.length; i++) {
    const code = string.charCodeAt(i);
    if (code > 127) {
      throw new TypeError("non-ASCII string encountered in encode()");
    }
    bytes[i] = code;
  }
  return bytes;
}
__name(encode, "encode");

// node_modules/jose/dist/webapi/lib/base64.js
function encodeBase64(input) {
  if (Uint8Array.prototype.toBase64) {
    return input.toBase64();
  }
  const CHUNK_SIZE = 32768;
  const arr = [];
  for (let i = 0; i < input.length; i += CHUNK_SIZE) {
    arr.push(String.fromCharCode.apply(null, input.subarray(i, i + CHUNK_SIZE)));
  }
  return btoa(arr.join(""));
}
__name(encodeBase64, "encodeBase64");
function decodeBase64(encoded) {
  if (Uint8Array.fromBase64) {
    return Uint8Array.fromBase64(encoded);
  }
  const binary = atob(encoded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}
__name(decodeBase64, "decodeBase64");

// node_modules/jose/dist/webapi/util/base64url.js
function decode(input) {
  if (Uint8Array.fromBase64) {
    return Uint8Array.fromBase64(typeof input === "string" ? input : decoder.decode(input), {
      alphabet: "base64url"
    });
  }
  let encoded = input;
  if (encoded instanceof Uint8Array) {
    encoded = decoder.decode(encoded);
  }
  encoded = encoded.replace(/-/g, "+").replace(/_/g, "/");
  try {
    return decodeBase64(encoded);
  } catch {
    throw new TypeError("The input to be decoded is not correctly encoded.");
  }
}
__name(decode, "decode");

// node_modules/jose/dist/webapi/lib/crypto_key.js
var unusable = /* @__PURE__ */ __name((name, prop = "algorithm.name") => new TypeError(`CryptoKey does not support this operation, its ${prop} must be ${name}`), "unusable");
var isAlgorithm = /* @__PURE__ */ __name((algorithm, name) => algorithm.name === name, "isAlgorithm");
function getHashLength(hash) {
  return parseInt(hash.name.slice(4), 10);
}
__name(getHashLength, "getHashLength");
function checkHashLength(algorithm, expected) {
  const actual = getHashLength(algorithm.hash);
  if (actual !== expected)
    throw unusable(`SHA-${expected}`, "algorithm.hash");
}
__name(checkHashLength, "checkHashLength");
function getNamedCurve(alg) {
  switch (alg) {
    case "ES256":
      return "P-256";
    case "ES384":
      return "P-384";
    case "ES512":
      return "P-521";
    default:
      throw new Error("unreachable");
  }
}
__name(getNamedCurve, "getNamedCurve");
function checkUsage(key, usage) {
  if (usage && !key.usages.includes(usage)) {
    throw new TypeError(`CryptoKey does not support this operation, its usages must include ${usage}.`);
  }
}
__name(checkUsage, "checkUsage");
function checkSigCryptoKey(key, alg, usage) {
  switch (alg) {
    case "HS256":
    case "HS384":
    case "HS512": {
      if (!isAlgorithm(key.algorithm, "HMAC"))
        throw unusable("HMAC");
      checkHashLength(key.algorithm, parseInt(alg.slice(2), 10));
      break;
    }
    case "RS256":
    case "RS384":
    case "RS512": {
      if (!isAlgorithm(key.algorithm, "RSASSA-PKCS1-v1_5"))
        throw unusable("RSASSA-PKCS1-v1_5");
      checkHashLength(key.algorithm, parseInt(alg.slice(2), 10));
      break;
    }
    case "PS256":
    case "PS384":
    case "PS512": {
      if (!isAlgorithm(key.algorithm, "RSA-PSS"))
        throw unusable("RSA-PSS");
      checkHashLength(key.algorithm, parseInt(alg.slice(2), 10));
      break;
    }
    case "Ed25519":
    case "EdDSA": {
      if (!isAlgorithm(key.algorithm, "Ed25519"))
        throw unusable("Ed25519");
      break;
    }
    case "ML-DSA-44":
    case "ML-DSA-65":
    case "ML-DSA-87": {
      if (!isAlgorithm(key.algorithm, alg))
        throw unusable(alg);
      break;
    }
    case "ES256":
    case "ES384":
    case "ES512": {
      if (!isAlgorithm(key.algorithm, "ECDSA"))
        throw unusable("ECDSA");
      const expected = getNamedCurve(alg);
      const actual = key.algorithm.namedCurve;
      if (actual !== expected)
        throw unusable(expected, "algorithm.namedCurve");
      break;
    }
    default:
      throw new TypeError("CryptoKey does not support this operation");
  }
  checkUsage(key, usage);
}
__name(checkSigCryptoKey, "checkSigCryptoKey");

// node_modules/jose/dist/webapi/lib/invalid_key_input.js
function message(msg, actual, ...types) {
  types = types.filter(Boolean);
  if (types.length > 2) {
    const last = types.pop();
    msg += `one of type ${types.join(", ")}, or ${last}.`;
  } else if (types.length === 2) {
    msg += `one of type ${types[0]} or ${types[1]}.`;
  } else {
    msg += `of type ${types[0]}.`;
  }
  if (actual == null) {
    msg += ` Received ${actual}`;
  } else if (typeof actual === "function" && actual.name) {
    msg += ` Received function ${actual.name}`;
  } else if (typeof actual === "object" && actual != null) {
    if (actual.constructor?.name) {
      msg += ` Received an instance of ${actual.constructor.name}`;
    }
  }
  return msg;
}
__name(message, "message");
var invalidKeyInput = /* @__PURE__ */ __name((actual, ...types) => message("Key must be ", actual, ...types), "invalidKeyInput");
var withAlg = /* @__PURE__ */ __name((alg, actual, ...types) => message(`Key for the ${alg} algorithm must be `, actual, ...types), "withAlg");

// node_modules/jose/dist/webapi/util/errors.js
var JOSEError = class extends Error {
  code = "ERR_JOSE_GENERIC";
  constructor(message2, options) {
    super(message2, options);
    this.name = this.constructor.name;
    Error.captureStackTrace?.(this, this.constructor);
  }
};
__name(JOSEError, "JOSEError");
__publicField(JOSEError, "code", "ERR_JOSE_GENERIC");
var JWTClaimValidationFailed = class extends JOSEError {
  code = "ERR_JWT_CLAIM_VALIDATION_FAILED";
  claim;
  reason;
  payload;
  constructor(message2, payload, claim = "unspecified", reason = "unspecified") {
    super(message2, { cause: { claim, reason, payload } });
    this.claim = claim;
    this.reason = reason;
    this.payload = payload;
  }
};
__name(JWTClaimValidationFailed, "JWTClaimValidationFailed");
__publicField(JWTClaimValidationFailed, "code", "ERR_JWT_CLAIM_VALIDATION_FAILED");
var JWTExpired = class extends JOSEError {
  code = "ERR_JWT_EXPIRED";
  claim;
  reason;
  payload;
  constructor(message2, payload, claim = "unspecified", reason = "unspecified") {
    super(message2, { cause: { claim, reason, payload } });
    this.claim = claim;
    this.reason = reason;
    this.payload = payload;
  }
};
__name(JWTExpired, "JWTExpired");
__publicField(JWTExpired, "code", "ERR_JWT_EXPIRED");
var JOSEAlgNotAllowed = class extends JOSEError {
  code = "ERR_JOSE_ALG_NOT_ALLOWED";
};
__name(JOSEAlgNotAllowed, "JOSEAlgNotAllowed");
__publicField(JOSEAlgNotAllowed, "code", "ERR_JOSE_ALG_NOT_ALLOWED");
var JOSENotSupported = class extends JOSEError {
  code = "ERR_JOSE_NOT_SUPPORTED";
};
__name(JOSENotSupported, "JOSENotSupported");
__publicField(JOSENotSupported, "code", "ERR_JOSE_NOT_SUPPORTED");
var JWSInvalid = class extends JOSEError {
  code = "ERR_JWS_INVALID";
};
__name(JWSInvalid, "JWSInvalid");
__publicField(JWSInvalid, "code", "ERR_JWS_INVALID");
var JWTInvalid = class extends JOSEError {
  code = "ERR_JWT_INVALID";
};
__name(JWTInvalid, "JWTInvalid");
__publicField(JWTInvalid, "code", "ERR_JWT_INVALID");
var JWKSMultipleMatchingKeys = class extends JOSEError {
  [Symbol.asyncIterator];
  code = "ERR_JWKS_MULTIPLE_MATCHING_KEYS";
  constructor(message2 = "multiple matching keys found in the JSON Web Key Set", options) {
    super(message2, options);
  }
};
__name(JWKSMultipleMatchingKeys, "JWKSMultipleMatchingKeys");
__publicField(JWKSMultipleMatchingKeys, "code", "ERR_JWKS_MULTIPLE_MATCHING_KEYS");
var JWSSignatureVerificationFailed = class extends JOSEError {
  code = "ERR_JWS_SIGNATURE_VERIFICATION_FAILED";
  constructor(message2 = "signature verification failed", options) {
    super(message2, options);
  }
};
__name(JWSSignatureVerificationFailed, "JWSSignatureVerificationFailed");
__publicField(JWSSignatureVerificationFailed, "code", "ERR_JWS_SIGNATURE_VERIFICATION_FAILED");

// node_modules/jose/dist/webapi/lib/is_key_like.js
var isCryptoKey = /* @__PURE__ */ __name((key) => {
  if (key?.[Symbol.toStringTag] === "CryptoKey")
    return true;
  try {
    return key instanceof CryptoKey;
  } catch {
    return false;
  }
}, "isCryptoKey");
var isKeyObject = /* @__PURE__ */ __name((key) => key?.[Symbol.toStringTag] === "KeyObject", "isKeyObject");
var isKeyLike = /* @__PURE__ */ __name((key) => isCryptoKey(key) || isKeyObject(key), "isKeyLike");

// node_modules/jose/dist/webapi/lib/helpers.js
var unprotected = Symbol();
function decodeBase64url(value, label, ErrorClass) {
  try {
    return decode(value);
  } catch {
    throw new ErrorClass(`Failed to base64url decode the ${label}`);
  }
}
__name(decodeBase64url, "decodeBase64url");

// node_modules/jose/dist/webapi/lib/type_checks.js
var isObjectLike = /* @__PURE__ */ __name((value) => typeof value === "object" && value !== null, "isObjectLike");
function isObject(input) {
  if (!isObjectLike(input) || Object.prototype.toString.call(input) !== "[object Object]") {
    return false;
  }
  if (Object.getPrototypeOf(input) === null) {
    return true;
  }
  let proto = input;
  while (Object.getPrototypeOf(proto) !== null) {
    proto = Object.getPrototypeOf(proto);
  }
  return Object.getPrototypeOf(input) === proto;
}
__name(isObject, "isObject");
function isDisjoint(...headers) {
  const sources = headers.filter(Boolean);
  if (sources.length === 0 || sources.length === 1) {
    return true;
  }
  let acc;
  for (const header of sources) {
    const parameters = Object.keys(header);
    if (!acc || acc.size === 0) {
      acc = new Set(parameters);
      continue;
    }
    for (const parameter of parameters) {
      if (acc.has(parameter)) {
        return false;
      }
      acc.add(parameter);
    }
  }
  return true;
}
__name(isDisjoint, "isDisjoint");
var isJWK = /* @__PURE__ */ __name((key) => isObject(key) && typeof key.kty === "string", "isJWK");
var isPrivateJWK = /* @__PURE__ */ __name((key) => key.kty !== "oct" && (key.kty === "AKP" && typeof key.priv === "string" || typeof key.d === "string"), "isPrivateJWK");
var isPublicJWK = /* @__PURE__ */ __name((key) => key.kty !== "oct" && key.d === void 0 && key.priv === void 0, "isPublicJWK");
var isSecretJWK = /* @__PURE__ */ __name((key) => key.kty === "oct" && typeof key.k === "string", "isSecretJWK");

// node_modules/jose/dist/webapi/lib/signing.js
function checkKeyLength(alg, key) {
  if (alg.startsWith("RS") || alg.startsWith("PS")) {
    const { modulusLength } = key.algorithm;
    if (typeof modulusLength !== "number" || modulusLength < 2048) {
      throw new TypeError(`${alg} requires key modulusLength to be 2048 bits or larger`);
    }
  }
}
__name(checkKeyLength, "checkKeyLength");
function subtleAlgorithm(alg, algorithm) {
  const hash = `SHA-${alg.slice(-3)}`;
  switch (alg) {
    case "HS256":
    case "HS384":
    case "HS512":
      return { hash, name: "HMAC" };
    case "PS256":
    case "PS384":
    case "PS512":
      return { hash, name: "RSA-PSS", saltLength: parseInt(alg.slice(-3), 10) >> 3 };
    case "RS256":
    case "RS384":
    case "RS512":
      return { hash, name: "RSASSA-PKCS1-v1_5" };
    case "ES256":
    case "ES384":
    case "ES512":
      return { hash, name: "ECDSA", namedCurve: algorithm.namedCurve };
    case "Ed25519":
    case "EdDSA":
      return { name: "Ed25519" };
    case "ML-DSA-44":
    case "ML-DSA-65":
    case "ML-DSA-87":
      return { name: alg };
    default:
      throw new JOSENotSupported(`alg ${alg} is not supported either by JOSE or your javascript runtime`);
  }
}
__name(subtleAlgorithm, "subtleAlgorithm");
async function getSigKey(alg, key, usage) {
  if (key instanceof Uint8Array) {
    if (!alg.startsWith("HS")) {
      throw new TypeError(invalidKeyInput(key, "CryptoKey", "KeyObject", "JSON Web Key"));
    }
    return crypto.subtle.importKey("raw", key, { hash: `SHA-${alg.slice(-3)}`, name: "HMAC" }, false, [usage]);
  }
  checkSigCryptoKey(key, alg, usage);
  return key;
}
__name(getSigKey, "getSigKey");
async function verify(alg, key, signature, data) {
  const cryptoKey = await getSigKey(alg, key, "verify");
  checkKeyLength(alg, cryptoKey);
  const algorithm = subtleAlgorithm(alg, cryptoKey.algorithm);
  try {
    return await crypto.subtle.verify(algorithm, cryptoKey, signature, data);
  } catch {
    return false;
  }
}
__name(verify, "verify");

// node_modules/jose/dist/webapi/lib/jwk_to_key.js
var unsupportedAlg = 'Invalid or unsupported JWK "alg" (Algorithm) Parameter value';
function subtleMapping(jwk) {
  let algorithm;
  let keyUsages;
  switch (jwk.kty) {
    case "AKP": {
      switch (jwk.alg) {
        case "ML-DSA-44":
        case "ML-DSA-65":
        case "ML-DSA-87":
          algorithm = { name: jwk.alg };
          keyUsages = jwk.priv ? ["sign"] : ["verify"];
          break;
        default:
          throw new JOSENotSupported(unsupportedAlg);
      }
      break;
    }
    case "RSA": {
      switch (jwk.alg) {
        case "PS256":
        case "PS384":
        case "PS512":
          algorithm = { name: "RSA-PSS", hash: `SHA-${jwk.alg.slice(-3)}` };
          keyUsages = jwk.d ? ["sign"] : ["verify"];
          break;
        case "RS256":
        case "RS384":
        case "RS512":
          algorithm = { name: "RSASSA-PKCS1-v1_5", hash: `SHA-${jwk.alg.slice(-3)}` };
          keyUsages = jwk.d ? ["sign"] : ["verify"];
          break;
        case "RSA-OAEP":
        case "RSA-OAEP-256":
        case "RSA-OAEP-384":
        case "RSA-OAEP-512":
          algorithm = {
            name: "RSA-OAEP",
            hash: `SHA-${parseInt(jwk.alg.slice(-3), 10) || 1}`
          };
          keyUsages = jwk.d ? ["decrypt", "unwrapKey"] : ["encrypt", "wrapKey"];
          break;
        default:
          throw new JOSENotSupported(unsupportedAlg);
      }
      break;
    }
    case "EC": {
      switch (jwk.alg) {
        case "ES256":
        case "ES384":
        case "ES512":
          algorithm = {
            name: "ECDSA",
            namedCurve: { ES256: "P-256", ES384: "P-384", ES512: "P-521" }[jwk.alg]
          };
          keyUsages = jwk.d ? ["sign"] : ["verify"];
          break;
        case "ECDH-ES":
        case "ECDH-ES+A128KW":
        case "ECDH-ES+A192KW":
        case "ECDH-ES+A256KW":
          algorithm = { name: "ECDH", namedCurve: jwk.crv };
          keyUsages = jwk.d ? ["deriveBits"] : [];
          break;
        default:
          throw new JOSENotSupported(unsupportedAlg);
      }
      break;
    }
    case "OKP": {
      switch (jwk.alg) {
        case "Ed25519":
        case "EdDSA":
          algorithm = { name: "Ed25519" };
          keyUsages = jwk.d ? ["sign"] : ["verify"];
          break;
        case "ECDH-ES":
        case "ECDH-ES+A128KW":
        case "ECDH-ES+A192KW":
        case "ECDH-ES+A256KW":
          algorithm = { name: jwk.crv };
          keyUsages = jwk.d ? ["deriveBits"] : [];
          break;
        default:
          throw new JOSENotSupported(unsupportedAlg);
      }
      break;
    }
    default:
      throw new JOSENotSupported('Invalid or unsupported JWK "kty" (Key Type) Parameter value');
  }
  return { algorithm, keyUsages };
}
__name(subtleMapping, "subtleMapping");
async function jwkToKey(jwk) {
  if (!jwk.alg) {
    throw new TypeError('"alg" argument is required when "jwk.alg" is not present');
  }
  const { algorithm, keyUsages } = subtleMapping(jwk);
  const keyData = { ...jwk };
  if (keyData.kty !== "AKP") {
    delete keyData.alg;
  }
  delete keyData.use;
  return crypto.subtle.importKey("jwk", keyData, algorithm, jwk.ext ?? (jwk.d || jwk.priv ? false : true), jwk.key_ops ?? keyUsages);
}
__name(jwkToKey, "jwkToKey");

// node_modules/jose/dist/webapi/lib/normalize_key.js
var unusableForAlg = "given KeyObject instance cannot be used for this algorithm";
var cache;
var handleJWK = /* @__PURE__ */ __name(async (key, jwk, alg, freeze = false) => {
  cache ||= /* @__PURE__ */ new WeakMap();
  let cached = cache.get(key);
  if (cached?.[alg]) {
    return cached[alg];
  }
  const cryptoKey = await jwkToKey({ ...jwk, alg });
  if (freeze)
    Object.freeze(key);
  if (!cached) {
    cache.set(key, { [alg]: cryptoKey });
  } else {
    cached[alg] = cryptoKey;
  }
  return cryptoKey;
}, "handleJWK");
var handleKeyObject = /* @__PURE__ */ __name((keyObject, alg) => {
  cache ||= /* @__PURE__ */ new WeakMap();
  let cached = cache.get(keyObject);
  if (cached?.[alg]) {
    return cached[alg];
  }
  const isPublic = keyObject.type === "public";
  const extractable = isPublic ? true : false;
  let cryptoKey;
  if (keyObject.asymmetricKeyType === "x25519") {
    switch (alg) {
      case "ECDH-ES":
      case "ECDH-ES+A128KW":
      case "ECDH-ES+A192KW":
      case "ECDH-ES+A256KW":
        break;
      default:
        throw new TypeError(unusableForAlg);
    }
    cryptoKey = keyObject.toCryptoKey(keyObject.asymmetricKeyType, extractable, isPublic ? [] : ["deriveBits"]);
  }
  if (keyObject.asymmetricKeyType === "ed25519") {
    if (alg !== "EdDSA" && alg !== "Ed25519") {
      throw new TypeError(unusableForAlg);
    }
    cryptoKey = keyObject.toCryptoKey(keyObject.asymmetricKeyType, extractable, [
      isPublic ? "verify" : "sign"
    ]);
  }
  switch (keyObject.asymmetricKeyType) {
    case "ml-dsa-44":
    case "ml-dsa-65":
    case "ml-dsa-87": {
      if (alg !== keyObject.asymmetricKeyType.toUpperCase()) {
        throw new TypeError(unusableForAlg);
      }
      cryptoKey = keyObject.toCryptoKey(keyObject.asymmetricKeyType, extractable, [
        isPublic ? "verify" : "sign"
      ]);
    }
  }
  if (keyObject.asymmetricKeyType === "rsa") {
    let hash;
    switch (alg) {
      case "RSA-OAEP":
        hash = "SHA-1";
        break;
      case "RS256":
      case "PS256":
      case "RSA-OAEP-256":
        hash = "SHA-256";
        break;
      case "RS384":
      case "PS384":
      case "RSA-OAEP-384":
        hash = "SHA-384";
        break;
      case "RS512":
      case "PS512":
      case "RSA-OAEP-512":
        hash = "SHA-512";
        break;
      default:
        throw new TypeError(unusableForAlg);
    }
    if (alg.startsWith("RSA-OAEP")) {
      return keyObject.toCryptoKey({
        name: "RSA-OAEP",
        hash
      }, extractable, isPublic ? ["encrypt"] : ["decrypt"]);
    }
    cryptoKey = keyObject.toCryptoKey({
      name: alg.startsWith("PS") ? "RSA-PSS" : "RSASSA-PKCS1-v1_5",
      hash
    }, extractable, [isPublic ? "verify" : "sign"]);
  }
  if (keyObject.asymmetricKeyType === "ec") {
    const nist = /* @__PURE__ */ new Map([
      ["prime256v1", "P-256"],
      ["secp384r1", "P-384"],
      ["secp521r1", "P-521"]
    ]);
    const namedCurve = nist.get(keyObject.asymmetricKeyDetails?.namedCurve);
    if (!namedCurve) {
      throw new TypeError(unusableForAlg);
    }
    const expectedCurve = { ES256: "P-256", ES384: "P-384", ES512: "P-521" };
    if (expectedCurve[alg] && namedCurve === expectedCurve[alg]) {
      cryptoKey = keyObject.toCryptoKey({
        name: "ECDSA",
        namedCurve
      }, extractable, [isPublic ? "verify" : "sign"]);
    }
    if (alg.startsWith("ECDH-ES")) {
      cryptoKey = keyObject.toCryptoKey({
        name: "ECDH",
        namedCurve
      }, extractable, isPublic ? [] : ["deriveBits"]);
    }
  }
  if (!cryptoKey) {
    throw new TypeError(unusableForAlg);
  }
  if (!cached) {
    cache.set(keyObject, { [alg]: cryptoKey });
  } else {
    cached[alg] = cryptoKey;
  }
  return cryptoKey;
}, "handleKeyObject");
async function normalizeKey(key, alg) {
  if (key instanceof Uint8Array) {
    return key;
  }
  if (isCryptoKey(key)) {
    return key;
  }
  if (isKeyObject(key)) {
    if (key.type === "secret") {
      return key.export();
    }
    if ("toCryptoKey" in key && typeof key.toCryptoKey === "function") {
      try {
        return handleKeyObject(key, alg);
      } catch (err) {
        if (err instanceof TypeError) {
          throw err;
        }
      }
    }
    let jwk = key.export({ format: "jwk" });
    return handleJWK(key, jwk, alg);
  }
  if (isJWK(key)) {
    if (key.k) {
      return decode(key.k);
    }
    return handleJWK(key, key, alg, true);
  }
  throw new Error("unreachable");
}
__name(normalizeKey, "normalizeKey");

// node_modules/jose/dist/webapi/lib/asn1.js
var formatPEM = /* @__PURE__ */ __name((b64, descriptor) => {
  const newlined = (b64.match(/.{1,64}/g) || []).join("\n");
  return `-----BEGIN ${descriptor}-----
${newlined}
-----END ${descriptor}-----`;
}, "formatPEM");
var bytesEqual = /* @__PURE__ */ __name((a, b) => {
  if (a.byteLength !== b.length)
    return false;
  for (let i = 0; i < a.byteLength; i++) {
    if (a[i] !== b[i])
      return false;
  }
  return true;
}, "bytesEqual");
var createASN1State = /* @__PURE__ */ __name((data) => ({ data, pos: 0 }), "createASN1State");
var parseLength = /* @__PURE__ */ __name((state) => {
  const first = state.data[state.pos++];
  if (first & 128) {
    const lengthOfLen = first & 127;
    let length = 0;
    for (let i = 0; i < lengthOfLen; i++) {
      length = length << 8 | state.data[state.pos++];
    }
    return length;
  }
  return first;
}, "parseLength");
var skipElement = /* @__PURE__ */ __name((state, count = 1) => {
  if (count <= 0)
    return;
  state.pos++;
  const length = parseLength(state);
  state.pos += length;
  if (count > 1) {
    skipElement(state, count - 1);
  }
}, "skipElement");
var expectTag = /* @__PURE__ */ __name((state, expectedTag, errorMessage) => {
  if (state.data[state.pos++] !== expectedTag) {
    throw new Error(errorMessage);
  }
}, "expectTag");
var getSubarray = /* @__PURE__ */ __name((state, length) => {
  const result = state.data.subarray(state.pos, state.pos + length);
  state.pos += length;
  return result;
}, "getSubarray");
var parseAlgorithmOID = /* @__PURE__ */ __name((state) => {
  expectTag(state, 6, "Expected algorithm OID");
  const oidLen = parseLength(state);
  return getSubarray(state, oidLen);
}, "parseAlgorithmOID");
function parseSPKIHeader(state) {
  expectTag(state, 48, "Invalid SPKI structure");
  parseLength(state);
  expectTag(state, 48, "Expected algorithm identifier");
  const algIdLen = parseLength(state);
  const algIdStart = state.pos;
  return { algIdStart, algIdLength: algIdLen };
}
__name(parseSPKIHeader, "parseSPKIHeader");
var parseECAlgorithmIdentifier = /* @__PURE__ */ __name((state) => {
  const algOid = parseAlgorithmOID(state);
  if (bytesEqual(algOid, [43, 101, 110])) {
    return "X25519";
  }
  if (!bytesEqual(algOid, [42, 134, 72, 206, 61, 2, 1])) {
    throw new Error("Unsupported key algorithm");
  }
  expectTag(state, 6, "Expected curve OID");
  const curveOidLen = parseLength(state);
  const curveOid = getSubarray(state, curveOidLen);
  for (const { name, oid } of [
    { name: "P-256", oid: [42, 134, 72, 206, 61, 3, 1, 7] },
    { name: "P-384", oid: [43, 129, 4, 0, 34] },
    { name: "P-521", oid: [43, 129, 4, 0, 35] }
  ]) {
    if (bytesEqual(curveOid, oid)) {
      return name;
    }
  }
  throw new Error("Unsupported named curve");
}, "parseECAlgorithmIdentifier");
var genericImport = /* @__PURE__ */ __name(async (keyFormat, keyData, alg, options) => {
  let algorithm;
  let keyUsages;
  const isPublic = keyFormat === "spki";
  const getSigUsages = /* @__PURE__ */ __name(() => isPublic ? ["verify"] : ["sign"], "getSigUsages");
  const getEncUsages = /* @__PURE__ */ __name(() => isPublic ? ["encrypt", "wrapKey"] : ["decrypt", "unwrapKey"], "getEncUsages");
  switch (alg) {
    case "PS256":
    case "PS384":
    case "PS512":
      algorithm = { name: "RSA-PSS", hash: `SHA-${alg.slice(-3)}` };
      keyUsages = getSigUsages();
      break;
    case "RS256":
    case "RS384":
    case "RS512":
      algorithm = { name: "RSASSA-PKCS1-v1_5", hash: `SHA-${alg.slice(-3)}` };
      keyUsages = getSigUsages();
      break;
    case "RSA-OAEP":
    case "RSA-OAEP-256":
    case "RSA-OAEP-384":
    case "RSA-OAEP-512":
      algorithm = {
        name: "RSA-OAEP",
        hash: `SHA-${parseInt(alg.slice(-3), 10) || 1}`
      };
      keyUsages = getEncUsages();
      break;
    case "ES256":
    case "ES384":
    case "ES512": {
      const curveMap = { ES256: "P-256", ES384: "P-384", ES512: "P-521" };
      algorithm = { name: "ECDSA", namedCurve: curveMap[alg] };
      keyUsages = getSigUsages();
      break;
    }
    case "ECDH-ES":
    case "ECDH-ES+A128KW":
    case "ECDH-ES+A192KW":
    case "ECDH-ES+A256KW": {
      try {
        const namedCurve = options.getNamedCurve(keyData);
        algorithm = namedCurve === "X25519" ? { name: "X25519" } : { name: "ECDH", namedCurve };
      } catch (cause) {
        throw new JOSENotSupported("Invalid or unsupported key format");
      }
      keyUsages = isPublic ? [] : ["deriveBits"];
      break;
    }
    case "Ed25519":
    case "EdDSA":
      algorithm = { name: "Ed25519" };
      keyUsages = getSigUsages();
      break;
    case "ML-DSA-44":
    case "ML-DSA-65":
    case "ML-DSA-87":
      algorithm = { name: alg };
      keyUsages = getSigUsages();
      break;
    default:
      throw new JOSENotSupported('Invalid or unsupported "alg" (Algorithm) value');
  }
  return crypto.subtle.importKey(keyFormat, keyData, algorithm, options?.extractable ?? (isPublic ? true : false), keyUsages);
}, "genericImport");
var processPEMData = /* @__PURE__ */ __name((pem, pattern) => {
  return decodeBase64(pem.replace(pattern, ""));
}, "processPEMData");
var fromSPKI = /* @__PURE__ */ __name((pem, alg, options) => {
  const keyData = processPEMData(pem, /(?:-----(?:BEGIN|END) PUBLIC KEY-----|\s)/g);
  let opts = options;
  if (alg?.startsWith?.("ECDH-ES")) {
    opts ||= {};
    opts.getNamedCurve = (keyData2) => {
      const state = createASN1State(keyData2);
      parseSPKIHeader(state);
      return parseECAlgorithmIdentifier(state);
    };
  }
  return genericImport("spki", keyData, alg, opts);
}, "fromSPKI");
function spkiFromX509(buf) {
  const state = createASN1State(buf);
  expectTag(state, 48, "Invalid certificate structure");
  parseLength(state);
  expectTag(state, 48, "Invalid tbsCertificate structure");
  parseLength(state);
  if (buf[state.pos] === 160) {
    skipElement(state, 6);
  } else {
    skipElement(state, 5);
  }
  const spkiStart = state.pos;
  expectTag(state, 48, "Invalid SPKI structure");
  const spkiContentLen = parseLength(state);
  return buf.subarray(spkiStart, spkiStart + spkiContentLen + (state.pos - spkiStart));
}
__name(spkiFromX509, "spkiFromX509");
function extractX509SPKI(x509) {
  const derBytes = processPEMData(x509, /(?:-----(?:BEGIN|END) CERTIFICATE-----|\s)/g);
  return spkiFromX509(derBytes);
}
__name(extractX509SPKI, "extractX509SPKI");
var fromX509 = /* @__PURE__ */ __name((pem, alg, options) => {
  let spki;
  try {
    spki = extractX509SPKI(pem);
  } catch (cause) {
    throw new TypeError("Failed to parse the X.509 certificate", { cause });
  }
  return fromSPKI(formatPEM(encodeBase64(spki), "PUBLIC KEY"), alg, options);
}, "fromX509");

// node_modules/jose/dist/webapi/key/import.js
async function importX509(x509, alg, options) {
  if (typeof x509 !== "string" || x509.indexOf("-----BEGIN CERTIFICATE-----") !== 0) {
    throw new TypeError('"x509" must be X.509 formatted string');
  }
  return fromX509(x509, alg, options);
}
__name(importX509, "importX509");

// node_modules/jose/dist/webapi/lib/validate_crit.js
function validateCrit(Err, recognizedDefault, recognizedOption, protectedHeader, joseHeader) {
  if (joseHeader.crit !== void 0 && protectedHeader?.crit === void 0) {
    throw new Err('"crit" (Critical) Header Parameter MUST be integrity protected');
  }
  if (!protectedHeader || protectedHeader.crit === void 0) {
    return /* @__PURE__ */ new Set();
  }
  if (!Array.isArray(protectedHeader.crit) || protectedHeader.crit.length === 0 || protectedHeader.crit.some((input) => typeof input !== "string" || input.length === 0)) {
    throw new Err('"crit" (Critical) Header Parameter MUST be an array of non-empty strings when present');
  }
  let recognized;
  if (recognizedOption !== void 0) {
    recognized = new Map([...Object.entries(recognizedOption), ...recognizedDefault.entries()]);
  } else {
    recognized = recognizedDefault;
  }
  for (const parameter of protectedHeader.crit) {
    if (!recognized.has(parameter)) {
      throw new JOSENotSupported(`Extension Header Parameter "${parameter}" is not recognized`);
    }
    if (joseHeader[parameter] === void 0) {
      throw new Err(`Extension Header Parameter "${parameter}" is missing`);
    }
    if (recognized.get(parameter) && protectedHeader[parameter] === void 0) {
      throw new Err(`Extension Header Parameter "${parameter}" MUST be integrity protected`);
    }
  }
  return new Set(protectedHeader.crit);
}
__name(validateCrit, "validateCrit");

// node_modules/jose/dist/webapi/lib/validate_algorithms.js
function validateAlgorithms(option, algorithms) {
  if (algorithms !== void 0 && (!Array.isArray(algorithms) || algorithms.some((s) => typeof s !== "string"))) {
    throw new TypeError(`"${option}" option must be an array of strings`);
  }
  if (!algorithms) {
    return void 0;
  }
  return new Set(algorithms);
}
__name(validateAlgorithms, "validateAlgorithms");

// node_modules/jose/dist/webapi/lib/check_key_type.js
var tag = /* @__PURE__ */ __name((key) => key?.[Symbol.toStringTag], "tag");
var jwkMatchesOp = /* @__PURE__ */ __name((alg, key, usage) => {
  if (key.use !== void 0) {
    let expected;
    switch (usage) {
      case "sign":
      case "verify":
        expected = "sig";
        break;
      case "encrypt":
      case "decrypt":
        expected = "enc";
        break;
    }
    if (key.use !== expected) {
      throw new TypeError(`Invalid key for this operation, its "use" must be "${expected}" when present`);
    }
  }
  if (key.alg !== void 0 && key.alg !== alg) {
    throw new TypeError(`Invalid key for this operation, its "alg" must be "${alg}" when present`);
  }
  if (Array.isArray(key.key_ops)) {
    let expectedKeyOp;
    switch (true) {
      case (usage === "sign" || usage === "verify"):
      case alg === "dir":
      case alg.includes("CBC-HS"):
        expectedKeyOp = usage;
        break;
      case alg.startsWith("PBES2"):
        expectedKeyOp = "deriveBits";
        break;
      case /^A\d{3}(?:GCM)?(?:KW)?$/.test(alg):
        if (!alg.includes("GCM") && alg.endsWith("KW")) {
          expectedKeyOp = usage === "encrypt" ? "wrapKey" : "unwrapKey";
        } else {
          expectedKeyOp = usage;
        }
        break;
      case (usage === "encrypt" && alg.startsWith("RSA")):
        expectedKeyOp = "wrapKey";
        break;
      case usage === "decrypt":
        expectedKeyOp = alg.startsWith("RSA") ? "unwrapKey" : "deriveBits";
        break;
    }
    if (expectedKeyOp && key.key_ops?.includes?.(expectedKeyOp) === false) {
      throw new TypeError(`Invalid key for this operation, its "key_ops" must include "${expectedKeyOp}" when present`);
    }
  }
  return true;
}, "jwkMatchesOp");
var symmetricTypeCheck = /* @__PURE__ */ __name((alg, key, usage) => {
  if (key instanceof Uint8Array)
    return;
  if (isJWK(key)) {
    if (isSecretJWK(key) && jwkMatchesOp(alg, key, usage))
      return;
    throw new TypeError(`JSON Web Key for symmetric algorithms must have JWK "kty" (Key Type) equal to "oct" and the JWK "k" (Key Value) present`);
  }
  if (!isKeyLike(key)) {
    throw new TypeError(withAlg(alg, key, "CryptoKey", "KeyObject", "JSON Web Key", "Uint8Array"));
  }
  if (key.type !== "secret") {
    throw new TypeError(`${tag(key)} instances for symmetric algorithms must be of type "secret"`);
  }
}, "symmetricTypeCheck");
var asymmetricTypeCheck = /* @__PURE__ */ __name((alg, key, usage) => {
  if (isJWK(key)) {
    switch (usage) {
      case "decrypt":
      case "sign":
        if (isPrivateJWK(key) && jwkMatchesOp(alg, key, usage))
          return;
        throw new TypeError(`JSON Web Key for this operation must be a private JWK`);
      case "encrypt":
      case "verify":
        if (isPublicJWK(key) && jwkMatchesOp(alg, key, usage))
          return;
        throw new TypeError(`JSON Web Key for this operation must be a public JWK`);
    }
  }
  if (!isKeyLike(key)) {
    throw new TypeError(withAlg(alg, key, "CryptoKey", "KeyObject", "JSON Web Key"));
  }
  if (key.type === "secret") {
    throw new TypeError(`${tag(key)} instances for asymmetric algorithms must not be of type "secret"`);
  }
  if (key.type === "public") {
    switch (usage) {
      case "sign":
        throw new TypeError(`${tag(key)} instances for asymmetric algorithm signing must be of type "private"`);
      case "decrypt":
        throw new TypeError(`${tag(key)} instances for asymmetric algorithm decryption must be of type "private"`);
    }
  }
  if (key.type === "private") {
    switch (usage) {
      case "verify":
        throw new TypeError(`${tag(key)} instances for asymmetric algorithm verifying must be of type "public"`);
      case "encrypt":
        throw new TypeError(`${tag(key)} instances for asymmetric algorithm encryption must be of type "public"`);
    }
  }
}, "asymmetricTypeCheck");
function checkKeyType(alg, key, usage) {
  switch (alg.substring(0, 2)) {
    case "A1":
    case "A2":
    case "di":
    case "HS":
    case "PB":
      symmetricTypeCheck(alg, key, usage);
      break;
    default:
      asymmetricTypeCheck(alg, key, usage);
  }
}
__name(checkKeyType, "checkKeyType");

// node_modules/jose/dist/webapi/jws/flattened/verify.js
async function flattenedVerify(jws, key, options) {
  if (!isObject(jws)) {
    throw new JWSInvalid("Flattened JWS must be an object");
  }
  if (jws.protected === void 0 && jws.header === void 0) {
    throw new JWSInvalid('Flattened JWS must have either of the "protected" or "header" members');
  }
  if (jws.protected !== void 0 && typeof jws.protected !== "string") {
    throw new JWSInvalid("JWS Protected Header incorrect type");
  }
  if (jws.payload === void 0) {
    throw new JWSInvalid("JWS Payload missing");
  }
  if (typeof jws.signature !== "string") {
    throw new JWSInvalid("JWS Signature missing or incorrect type");
  }
  if (jws.header !== void 0 && !isObject(jws.header)) {
    throw new JWSInvalid("JWS Unprotected Header incorrect type");
  }
  let parsedProt = {};
  if (jws.protected) {
    try {
      const protectedHeader = decode(jws.protected);
      parsedProt = JSON.parse(decoder.decode(protectedHeader));
    } catch {
      throw new JWSInvalid("JWS Protected Header is invalid");
    }
  }
  if (!isDisjoint(parsedProt, jws.header)) {
    throw new JWSInvalid("JWS Protected and JWS Unprotected Header Parameter names must be disjoint");
  }
  const joseHeader = {
    ...parsedProt,
    ...jws.header
  };
  const extensions = validateCrit(JWSInvalid, /* @__PURE__ */ new Map([["b64", true]]), options?.crit, parsedProt, joseHeader);
  let b64 = true;
  if (extensions.has("b64")) {
    b64 = parsedProt.b64;
    if (typeof b64 !== "boolean") {
      throw new JWSInvalid('The "b64" (base64url-encode payload) Header Parameter must be a boolean');
    }
  }
  const { alg } = joseHeader;
  if (typeof alg !== "string" || !alg) {
    throw new JWSInvalid('JWS "alg" (Algorithm) Header Parameter missing or invalid');
  }
  const algorithms = options && validateAlgorithms("algorithms", options.algorithms);
  if (algorithms && !algorithms.has(alg)) {
    throw new JOSEAlgNotAllowed('"alg" (Algorithm) Header Parameter value not allowed');
  }
  if (b64) {
    if (typeof jws.payload !== "string") {
      throw new JWSInvalid("JWS Payload must be a string");
    }
  } else if (typeof jws.payload !== "string" && !(jws.payload instanceof Uint8Array)) {
    throw new JWSInvalid("JWS Payload must be a string or an Uint8Array instance");
  }
  let resolvedKey = false;
  if (typeof key === "function") {
    key = await key(parsedProt, jws);
    resolvedKey = true;
  }
  checkKeyType(alg, key, "verify");
  const data = concat(jws.protected !== void 0 ? encode(jws.protected) : new Uint8Array(), encode("."), typeof jws.payload === "string" ? b64 ? encode(jws.payload) : encoder.encode(jws.payload) : jws.payload);
  const signature = decodeBase64url(jws.signature, "signature", JWSInvalid);
  const k = await normalizeKey(key, alg);
  const verified = await verify(alg, k, signature, data);
  if (!verified) {
    throw new JWSSignatureVerificationFailed();
  }
  let payload;
  if (b64) {
    payload = decodeBase64url(jws.payload, "payload", JWSInvalid);
  } else if (typeof jws.payload === "string") {
    payload = encoder.encode(jws.payload);
  } else {
    payload = jws.payload;
  }
  const result = { payload };
  if (jws.protected !== void 0) {
    result.protectedHeader = parsedProt;
  }
  if (jws.header !== void 0) {
    result.unprotectedHeader = jws.header;
  }
  if (resolvedKey) {
    return { ...result, key: k };
  }
  return result;
}
__name(flattenedVerify, "flattenedVerify");

// node_modules/jose/dist/webapi/jws/compact/verify.js
async function compactVerify(jws, key, options) {
  if (jws instanceof Uint8Array) {
    jws = decoder.decode(jws);
  }
  if (typeof jws !== "string") {
    throw new JWSInvalid("Compact JWS must be a string or Uint8Array");
  }
  const { 0: protectedHeader, 1: payload, 2: signature, length } = jws.split(".");
  if (length !== 3) {
    throw new JWSInvalid("Invalid Compact JWS");
  }
  const verified = await flattenedVerify({ payload, protected: protectedHeader, signature }, key, options);
  const result = { payload: verified.payload, protectedHeader: verified.protectedHeader };
  if (typeof key === "function") {
    return { ...result, key: verified.key };
  }
  return result;
}
__name(compactVerify, "compactVerify");

// node_modules/jose/dist/webapi/lib/jwt_claims_set.js
var epoch = /* @__PURE__ */ __name((date) => Math.floor(date.getTime() / 1e3), "epoch");
var minute = 60;
var hour = minute * 60;
var day = hour * 24;
var week = day * 7;
var year = day * 365.25;
var REGEX = /^(\+|\-)? ?(\d+|\d+\.\d+) ?(seconds?|secs?|s|minutes?|mins?|m|hours?|hrs?|h|days?|d|weeks?|w|years?|yrs?|y)(?: (ago|from now))?$/i;
function secs(str) {
  const matched = REGEX.exec(str);
  if (!matched || matched[4] && matched[1]) {
    throw new TypeError("Invalid time period format");
  }
  const value = parseFloat(matched[2]);
  const unit = matched[3].toLowerCase();
  let numericDate;
  switch (unit) {
    case "sec":
    case "secs":
    case "second":
    case "seconds":
    case "s":
      numericDate = Math.round(value);
      break;
    case "minute":
    case "minutes":
    case "min":
    case "mins":
    case "m":
      numericDate = Math.round(value * minute);
      break;
    case "hour":
    case "hours":
    case "hr":
    case "hrs":
    case "h":
      numericDate = Math.round(value * hour);
      break;
    case "day":
    case "days":
    case "d":
      numericDate = Math.round(value * day);
      break;
    case "week":
    case "weeks":
    case "w":
      numericDate = Math.round(value * week);
      break;
    default:
      numericDate = Math.round(value * year);
      break;
  }
  if (matched[1] === "-" || matched[4] === "ago") {
    return -numericDate;
  }
  return numericDate;
}
__name(secs, "secs");
var normalizeTyp = /* @__PURE__ */ __name((value) => {
  if (value.includes("/")) {
    return value.toLowerCase();
  }
  return `application/${value.toLowerCase()}`;
}, "normalizeTyp");
var checkAudiencePresence = /* @__PURE__ */ __name((audPayload, audOption) => {
  if (typeof audPayload === "string") {
    return audOption.includes(audPayload);
  }
  if (Array.isArray(audPayload)) {
    return audOption.some(Set.prototype.has.bind(new Set(audPayload)));
  }
  return false;
}, "checkAudiencePresence");
function validateClaimsSet(protectedHeader, encodedPayload, options = {}) {
  let payload;
  try {
    payload = JSON.parse(decoder.decode(encodedPayload));
  } catch {
  }
  if (!isObject(payload)) {
    throw new JWTInvalid("JWT Claims Set must be a top-level JSON object");
  }
  const { typ } = options;
  if (typ && (typeof protectedHeader.typ !== "string" || normalizeTyp(protectedHeader.typ) !== normalizeTyp(typ))) {
    throw new JWTClaimValidationFailed('unexpected "typ" JWT header value', payload, "typ", "check_failed");
  }
  const { requiredClaims = [], issuer, subject, audience, maxTokenAge } = options;
  const presenceCheck = [...requiredClaims];
  if (maxTokenAge !== void 0)
    presenceCheck.push("iat");
  if (audience !== void 0)
    presenceCheck.push("aud");
  if (subject !== void 0)
    presenceCheck.push("sub");
  if (issuer !== void 0)
    presenceCheck.push("iss");
  for (const claim of new Set(presenceCheck.reverse())) {
    if (!(claim in payload)) {
      throw new JWTClaimValidationFailed(`missing required "${claim}" claim`, payload, claim, "missing");
    }
  }
  if (issuer && !(Array.isArray(issuer) ? issuer : [issuer]).includes(payload.iss)) {
    throw new JWTClaimValidationFailed('unexpected "iss" claim value', payload, "iss", "check_failed");
  }
  if (subject && payload.sub !== subject) {
    throw new JWTClaimValidationFailed('unexpected "sub" claim value', payload, "sub", "check_failed");
  }
  if (audience && !checkAudiencePresence(payload.aud, typeof audience === "string" ? [audience] : audience)) {
    throw new JWTClaimValidationFailed('unexpected "aud" claim value', payload, "aud", "check_failed");
  }
  let tolerance;
  switch (typeof options.clockTolerance) {
    case "string":
      tolerance = secs(options.clockTolerance);
      break;
    case "number":
      tolerance = options.clockTolerance;
      break;
    case "undefined":
      tolerance = 0;
      break;
    default:
      throw new TypeError("Invalid clockTolerance option type");
  }
  const { currentDate } = options;
  const now = epoch(currentDate || /* @__PURE__ */ new Date());
  if ((payload.iat !== void 0 || maxTokenAge) && typeof payload.iat !== "number") {
    throw new JWTClaimValidationFailed('"iat" claim must be a number', payload, "iat", "invalid");
  }
  if (payload.nbf !== void 0) {
    if (typeof payload.nbf !== "number") {
      throw new JWTClaimValidationFailed('"nbf" claim must be a number', payload, "nbf", "invalid");
    }
    if (payload.nbf > now + tolerance) {
      throw new JWTClaimValidationFailed('"nbf" claim timestamp check failed', payload, "nbf", "check_failed");
    }
  }
  if (payload.exp !== void 0) {
    if (typeof payload.exp !== "number") {
      throw new JWTClaimValidationFailed('"exp" claim must be a number', payload, "exp", "invalid");
    }
    if (payload.exp <= now - tolerance) {
      throw new JWTExpired('"exp" claim timestamp check failed', payload, "exp", "check_failed");
    }
  }
  if (maxTokenAge) {
    const age = now - payload.iat;
    const max = typeof maxTokenAge === "number" ? maxTokenAge : secs(maxTokenAge);
    if (age - tolerance > max) {
      throw new JWTExpired('"iat" claim timestamp check failed (too far in the past)', payload, "iat", "check_failed");
    }
    if (age < 0 - tolerance) {
      throw new JWTClaimValidationFailed('"iat" claim timestamp check failed (it should be in the past)', payload, "iat", "check_failed");
    }
  }
  return payload;
}
__name(validateClaimsSet, "validateClaimsSet");

// node_modules/jose/dist/webapi/jwt/verify.js
async function jwtVerify(jwt, key, options) {
  const verified = await compactVerify(jwt, key, options);
  if (verified.protectedHeader.crit?.includes("b64") && verified.protectedHeader.b64 === false) {
    throw new JWTInvalid("JWTs MUST NOT use unencoded payload");
  }
  const payload = validateClaimsSet(verified.protectedHeader, verified.payload, options);
  const result = { payload, protectedHeader: verified.protectedHeader };
  if (typeof key === "function") {
    return { ...result, key: verified.key };
  }
  return result;
}
__name(jwtVerify, "jwtVerify");

// src/ai/aiTiers.js
var AI_TIERS = {
  seeker: { kind: "oneply", evalName: "simple" },
  hunter: { kind: "fixedab", depth: 3, evalName: "basic", timeMs: 2e3 },
  collector: { kind: "mctsrave", simBudget: 25e3, timeMs: 12e3, policy: "heavy", endgame: true, reuseTree: true, rolloutShortcut: false }
};
var TIER_ORDER = ["seeker", "hunter", "collector"];
var ENDGAME_THRESHOLD = 12;
var ENDGAME_SAFETY_MS = 2e3;
var EVAL_BASIC_MATERIAL = 10;
var EVAL_BASIC_LIBERTY = 0.4;
var EVAL_BASIC_NEUTRAL_PEN = 0.5;
var MCTS_C = 0.5;
var RAVE_K = 3e3;
var PW_ALPHA = 0.5;
var WIN_MAG = 1e5;

// src/ai/bots.js
var BOT_UID_PREFIX = "bot:";
var botUidFor = /* @__PURE__ */ __name((tier) => `${BOT_UID_PREFIX}${tier}`, "botUidFor");
var isBotUid = /* @__PURE__ */ __name((uid) => typeof uid === "string" && uid.startsWith(BOT_UID_PREFIX), "isBotUid");
var tierFromBotUid = /* @__PURE__ */ __name((uid) => isBotUid(uid) ? uid.slice(BOT_UID_PREFIX.length) : null, "tierFromBotUid");
var BOT_DISPLAY = {
  seeker: "Seeker \u{1F916}",
  hunter: "Hunter \u{1F916}",
  collector: "Collector \u{1F916}"
};
var BOT_INITIAL_RATING = {
  seeker: 1e3,
  hunter: 1400,
  collector: 1800
};
var STANDARD_BOT_GRID_SIZES = [6, 8, 10, 12];
var standardBotQueueDocId = /* @__PURE__ */ __name((tier, gridSize) => `${botUidFor(tier)}_${gridSize}`, "standardBotQueueDocId");
var rankedBotQueueDocId = /* @__PURE__ */ __name((tier) => botUidFor(tier), "rankedBotQueueDocId");
var ALL_TIERS = TIER_ORDER;

// src/bootstrap/seedBots.js
var DEFAULT_SIGMA = 500;
var DISPLAY_DIVISOR = 2485;
var MAX_MU = 5e3;
function muFromDisplay(displayRating) {
  const scaled = Math.max(0, displayRating) * Math.LN2 / 1e3;
  if (scaled === 0)
    return DEFAULT_SIGMA * 3;
  const conservative = DISPLAY_DIVISOR * Math.log(Math.expm1(scaled));
  return Math.min(MAX_MU, Math.max(0, conservative + 3 * DEFAULT_SIGMA));
}
__name(muFromDisplay, "muFromDisplay");
async function seedBots(env, helpers) {
  const { getDocument: getDocument2, writeDocument: writeDocument2 } = helpers;
  const now = Date.now();
  const nowIso = new Date(now).toISOString();
  for (const tier of ALL_TIERS) {
    const uid = botUidFor(tier);
    const existing = await getDocument2(env, "players", uid);
    if (existing)
      continue;
    const initialRating = BOT_INITIAL_RATING[tier];
    const mu = muFromDisplay(initialRating);
    await writeDocument2(env, "players", uid, {
      displayName: BOT_DISPLAY[tier],
      mu,
      sigma: DEFAULT_SIGMA,
      rating: initialRating,
      games: 0,
      wins: 0,
      losses: 0,
      draws: 0,
      state: "idle",
      isBot: true,
      botTier: tier,
      updatedAt: nowIso
    });
  }
  for (const tier of ALL_TIERS) {
    const uid = botUidFor(tier);
    const profile = await getDocument2(env, "players", uid);
    const data = profile?.data || {};
    const entryBase = {
      uid,
      isBot: true,
      botTier: tier,
      displayName: BOT_DISPLAY[tier],
      mu: Number(data.mu) || muFromDisplay(BOT_INITIAL_RATING[tier]),
      sigma: Number(data.sigma) || DEFAULT_SIGMA,
      rating: Number(data.rating) || BOT_INITIAL_RATING[tier],
      status: "searching",
      gameId: null,
      matchedWith: null,
      joinedAtMs: now,
      updatedAtMs: now,
      updatedAt: nowIso
    };
    for (const gridSize of STANDARD_BOT_GRID_SIZES) {
      const docId = standardBotQueueDocId(tier, gridSize);
      const existing2 = await getDocument2(env, "matchmakingQueue_standard", docId);
      const updateTime2 = existing2?.updateTime;
      const entry2 = {
        ...entryBase,
        mode: "standard",
        gridSize,
        timerEnabled: true
      };
      try {
        await writeDocument2(env, "matchmakingQueue_standard", docId, entry2, updateTime2);
      } catch (_) {
      }
    }
    const rankedDocId = rankedBotQueueDocId(tier);
    const existing = await getDocument2(env, "matchmakingQueue_ranked", rankedDocId);
    const updateTime = existing?.updateTime;
    const entry = {
      ...entryBase,
      mode: "ranked",
      gridSize: 8,
      timerEnabled: true
    };
    try {
      await writeDocument2(env, "matchmakingQueue_ranked", rankedDocId, entry, updateTime);
    } catch (_) {
    }
  }
}
__name(seedBots, "seedBots");

// src/ai/aiEngine.js
var PLACE = 0;
var ELIMINATE = 1;
var FLAG_EXACT = 0;
var FLAG_LOWER = 1;
var FLAG_UPPER = 2;
var INF = 1e9;
var MAX_PLY = 64;
var TT_CAP = 5e5;
var HISTORY_OVERFLOW = 1 << 28;
var ENDGAME_TT_DEPTH = 99;
var size = 0;
var N2 = 0;
var cells = null;
var dead = null;
var phase = PLACE;
var side = 1;
var lastIdx = -1;
var hashLo = 0;
var hashHi = 0;
var tt = null;
var history = null;
var killers = null;
var moveBufs = null;
var scoreBuf = null;
var visitedBuf = null;
var stackBuf = null;
var frontierBuf = null;
var deadline = 0;
var timedOut = false;
var currentEval = null;
var zN2 = 0;
var Z_CELL_LO = null;
var Z_CELL_HI = null;
var Z_LAST_LO = null;
var Z_LAST_HI = null;
var Z_PHASE_LO = 0;
var Z_PHASE_HI = 0;
var Z_SIDE_LO = 0;
var Z_SIDE_HI = 0;
function rand32() {
  return Math.random() * 4294967296 | 0;
}
__name(rand32, "rand32");
function ensureZobrist() {
  if (Z_CELL_LO && zN2 === N2)
    return;
  zN2 = N2;
  Z_CELL_LO = new Int32Array(3 * N2);
  Z_CELL_HI = new Int32Array(3 * N2);
  for (let i = 0; i < 3 * N2; i++) {
    Z_CELL_LO[i] = rand32();
    Z_CELL_HI[i] = rand32();
  }
  Z_LAST_LO = new Int32Array(N2);
  Z_LAST_HI = new Int32Array(N2);
  for (let i = 0; i < N2; i++) {
    Z_LAST_LO[i] = rand32();
    Z_LAST_HI[i] = rand32();
  }
  Z_PHASE_LO = rand32();
  Z_PHASE_HI = rand32();
  Z_SIDE_LO = rand32();
  Z_SIDE_HI = rand32();
}
__name(ensureZobrist, "ensureZobrist");
function computeInitialHash() {
  hashLo = 0;
  hashHi = 0;
  for (let i = 0; i < N2; i++) {
    if (cells[i] === 1) {
      hashLo ^= Z_CELL_LO[i];
      hashHi ^= Z_CELL_HI[i];
    } else if (cells[i] === 2) {
      hashLo ^= Z_CELL_LO[N2 + i];
      hashHi ^= Z_CELL_HI[N2 + i];
    } else if (dead[i]) {
      hashLo ^= Z_CELL_LO[2 * N2 + i];
      hashHi ^= Z_CELL_HI[2 * N2 + i];
    }
  }
  if (phase === ELIMINATE) {
    hashLo ^= Z_PHASE_LO;
    hashHi ^= Z_PHASE_HI;
    if (lastIdx >= 0) {
      hashLo ^= Z_LAST_LO[lastIdx];
      hashHi ^= Z_LAST_HI[lastIdx];
    }
  }
  if (side === 2) {
    hashLo ^= Z_SIDE_LO;
    hashHi ^= Z_SIDE_HI;
  }
}
__name(computeInitialHash, "computeInitialHash");
function applyPlace(idx) {
  cells[idx] = side;
  const sIdx = (side - 1) * N2 + idx;
  hashLo ^= Z_CELL_LO[sIdx];
  hashHi ^= Z_CELL_HI[sIdx];
  hashLo ^= Z_PHASE_LO;
  hashHi ^= Z_PHASE_HI;
  hashLo ^= Z_LAST_LO[idx];
  hashHi ^= Z_LAST_HI[idx];
  lastIdx = idx;
  phase = ELIMINATE;
}
__name(applyPlace, "applyPlace");
function undoPlace(idx) {
  cells[idx] = 0;
  const sIdx = (side - 1) * N2 + idx;
  hashLo ^= Z_CELL_LO[sIdx];
  hashHi ^= Z_CELL_HI[sIdx];
  hashLo ^= Z_PHASE_LO;
  hashHi ^= Z_PHASE_HI;
  hashLo ^= Z_LAST_LO[idx];
  hashHi ^= Z_LAST_HI[idx];
  lastIdx = -1;
  phase = PLACE;
}
__name(undoPlace, "undoPlace");
function applyEliminate(idx) {
  dead[idx] = 1;
  const sIdx = 2 * N2 + idx;
  hashLo ^= Z_CELL_LO[sIdx];
  hashHi ^= Z_CELL_HI[sIdx];
  hashLo ^= Z_LAST_LO[lastIdx];
  hashHi ^= Z_LAST_HI[lastIdx];
  hashLo ^= Z_PHASE_LO;
  hashHi ^= Z_PHASE_HI;
  side = side === 1 ? 2 : 1;
  hashLo ^= Z_SIDE_LO;
  hashHi ^= Z_SIDE_HI;
  lastIdx = -1;
  phase = PLACE;
}
__name(applyEliminate, "applyEliminate");
function undoEliminate(idx, prevLastIdx) {
  hashLo ^= Z_SIDE_LO;
  hashHi ^= Z_SIDE_HI;
  side = side === 1 ? 2 : 1;
  hashLo ^= Z_PHASE_LO;
  hashHi ^= Z_PHASE_HI;
  hashLo ^= Z_LAST_LO[prevLastIdx];
  hashHi ^= Z_LAST_HI[prevLastIdx];
  lastIdx = prevLastIdx;
  dead[idx] = 0;
  const sIdx = 2 * N2 + idx;
  hashLo ^= Z_CELL_LO[sIdx];
  hashHi ^= Z_CELL_HI[sIdx];
  phase = ELIMINATE;
}
__name(undoEliminate, "undoEliminate");
function hasAdjacentFreeIdx(idx) {
  const r = idx / size | 0;
  const c = idx - r * size;
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      if (dr === 0 && dc === 0)
        continue;
      const nr = r + dr, nc = c + dc;
      if (nr < 0 || nr >= size || nc < 0 || nc >= size)
        continue;
      const v = nr * size + nc;
      if (cells[v] === 0 && !dead[v])
        return true;
    }
  }
  return false;
}
__name(hasAdjacentFreeIdx, "hasAdjacentFreeIdx");
function genPlacements(buf) {
  let n = 0;
  for (let i = 0; i < N2; i++) {
    if (cells[i] !== 0 || dead[i])
      continue;
    if (hasAdjacentFreeIdx(i))
      buf[n++] = i;
  }
  return n;
}
__name(genPlacements, "genPlacements");
function genEliminations(buf, lastI) {
  let n = 0;
  if (lastI < 0)
    return 0;
  const lr = lastI / size | 0;
  const lc = lastI - lr * size;
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      if (dr === 0 && dc === 0)
        continue;
      const r = lr + dr, c = lc + dc;
      if (r < 0 || r >= size || c < 0 || c >= size)
        continue;
      const idx = r * size + c;
      if (cells[idx] === 0 && !dead[idx])
        buf[n++] = idx;
    }
  }
  return n;
}
__name(genEliminations, "genEliminations");
function biggestGroup(player) {
  let best = 0;
  visitedBuf.fill(0);
  for (let start = 0; start < N2; start++) {
    if (cells[start] !== player || visitedBuf[start])
      continue;
    let count = 0;
    let sp = 0;
    stackBuf[sp++] = start;
    visitedBuf[start] = 1;
    while (sp > 0) {
      const u = stackBuf[--sp];
      count++;
      const ur = u / size | 0;
      const uc = u - ur * size;
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          if (dr === 0 && dc === 0)
            continue;
          const nr = ur + dr, nc = uc + dc;
          if (nr < 0 || nr >= size || nc < 0 || nc >= size)
            continue;
          const v = nr * size + nc;
          if (!visitedBuf[v] && cells[v] === player) {
            visitedBuf[v] = 1;
            stackBuf[sp++] = v;
          }
        }
      }
    }
    if (count > best)
      best = count;
  }
  return best;
}
__name(biggestGroup, "biggestGroup");
function biggestGroupSizeAndFrontier(player) {
  visitedBuf.fill(0);
  let bestSize = 0;
  let bestAnchor = -1;
  for (let start = 0; start < N2; start++) {
    if (cells[start] !== player || visitedBuf[start])
      continue;
    let count = 0;
    let sp2 = 0;
    stackBuf[sp2++] = start;
    visitedBuf[start] = 1;
    const anchor = start;
    while (sp2 > 0) {
      const u = stackBuf[--sp2];
      count++;
      const ur = u / size | 0;
      const uc = u - ur * size;
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          if (dr === 0 && dc === 0)
            continue;
          const nr = ur + dr, nc = uc + dc;
          if (nr < 0 || nr >= size || nc < 0 || nc >= size)
            continue;
          const v = nr * size + nc;
          if (!visitedBuf[v] && cells[v] === player) {
            visitedBuf[v] = 1;
            stackBuf[sp2++] = v;
          }
        }
      }
    }
    if (count > bestSize) {
      bestSize = count;
      bestAnchor = anchor;
    }
  }
  if (bestAnchor < 0)
    return { size: 0, frontier: 0 };
  visitedBuf.fill(0);
  frontierBuf.fill(0);
  let sp = 0;
  stackBuf[sp++] = bestAnchor;
  visitedBuf[bestAnchor] = 1;
  let frontier = 0;
  while (sp > 0) {
    const u = stackBuf[--sp];
    const ur = u / size | 0;
    const uc = u - ur * size;
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        if (dr === 0 && dc === 0)
          continue;
        const nr = ur + dr, nc = uc + dc;
        if (nr < 0 || nr >= size || nc < 0 || nc >= size)
          continue;
        const v = nr * size + nc;
        if (visitedBuf[v])
          continue;
        if (cells[v] === player) {
          visitedBuf[v] = 1;
          stackBuf[sp++] = v;
        } else if (cells[v] === 0 && !dead[v] && !frontierBuf[v]) {
          frontierBuf[v] = 1;
          frontier++;
        }
      }
    }
  }
  return { size: bestSize, frontier };
}
__name(biggestGroupSizeAndFrontier, "biggestGroupSizeAndFrontier");
function totalLiberties(player) {
  let n = 0;
  frontierBuf.fill(0);
  for (let i = 0; i < N2; i++) {
    if (cells[i] !== player)
      continue;
    const r = i / size | 0;
    const c = i - r * size;
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        if (dr === 0 && dc === 0)
          continue;
        const nr = r + dr, nc = c + dc;
        if (nr < 0 || nr >= size || nc < 0 || nc >= size)
          continue;
        const v = nr * size + nc;
        if (cells[v] === 0 && !dead[v] && !frontierBuf[v]) {
          frontierBuf[v] = 1;
          n++;
        }
      }
    }
  }
  return n;
}
__name(totalLiberties, "totalLiberties");
function neutralAdjacentToOwn(player) {
  let n = 0;
  for (let i = 0; i < N2; i++) {
    if (!dead[i])
      continue;
    const r = i / size | 0;
    const c = i - r * size;
    let touches = false;
    for (let dr = -1; dr <= 1 && !touches; dr++) {
      for (let dc = -1; dc <= 1 && !touches; dc++) {
        if (dr === 0 && dc === 0)
          continue;
        const nr = r + dr, nc = c + dc;
        if (nr < 0 || nr >= size || nc < 0 || nc >= size)
          continue;
        if (cells[nr * size + nc] === player)
          touches = true;
      }
    }
    if (touches)
      n++;
  }
  return n;
}
__name(neutralAdjacentToOwn, "neutralAdjacentToOwn");
function evalSimple() {
  return biggestGroup(side) - biggestGroup(side === 1 ? 2 : 1);
}
__name(evalSimple, "evalSimple");
function evalBasic() {
  const opp = side === 1 ? 2 : 1;
  const my = biggestGroupSizeAndFrontier(side);
  const op = biggestGroupSizeAndFrontier(opp);
  const myLib = totalLiberties(side);
  const opLib = totalLiberties(opp);
  const myNeut = neutralAdjacentToOwn(side);
  const opNeut = neutralAdjacentToOwn(opp);
  return EVAL_BASIC_MATERIAL * (my.size - op.size) + EVAL_BASIC_LIBERTY * (myLib - opLib) - EVAL_BASIC_NEUTRAL_PEN * (myNeut - opNeut);
}
__name(evalBasic, "evalBasic");
var EVAL_BY_NAME = {
  simple: evalSimple,
  basic: evalBasic
};
function evaluate() {
  return currentEval();
}
__name(evaluate, "evaluate");
function countAdjacentDots(idx, who) {
  const r = idx / size | 0;
  const c = idx - r * size;
  let n = 0;
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      if (dr === 0 && dc === 0)
        continue;
      const nr = r + dr, nc = c + dc;
      if (nr < 0 || nr >= size || nc < 0 || nc >= size)
        continue;
      if (cells[nr * size + nc] === who)
        n++;
    }
  }
  return n;
}
__name(countAdjacentDots, "countAdjacentDots");
function countAdjacentDead(idx) {
  const r = idx / size | 0;
  const c = idx - r * size;
  let n = 0;
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      if (dr === 0 && dc === 0)
        continue;
      const nr = r + dr, nc = c + dc;
      if (nr < 0 || nr >= size || nc < 0 || nc >= size)
        continue;
      if (dead[nr * size + nc])
        n++;
    }
  }
  return n;
}
__name(countAdjacentDead, "countAdjacentDead");
function isGrabMove(m) {
  if (phase === PLACE)
    return countAdjacentDots(m, side) > 0;
  return countAdjacentDots(m, side === 1 ? 2 : 1) > 0;
}
__name(isGrabMove, "isGrabMove");
function histIdx(s, p, m) {
  return ((s - 1) * 2 + p) * N2 + m;
}
__name(histIdx, "histIdx");
function bumpHistory(s, p, m, depth) {
  const i = histIdx(s, p, m);
  history[i] += depth * depth;
  if (history[i] > HISTORY_OVERFLOW) {
    for (let k = 0; k < history.length; k++)
      history[k] = history[k] / 2;
  }
}
__name(bumpHistory, "bumpHistory");
function pushKiller(ply, m) {
  const k0 = killers[ply * 2];
  if (k0 === m)
    return;
  killers[ply * 2 + 1] = k0;
  killers[ply * 2] = m;
}
__name(pushKiller, "pushKiller");
function orderMoves(buf, n, ttMove, ply) {
  const phaseIdx = phase === ELIMINATE ? 1 : 0;
  for (let i = 0; i < n; i++) {
    const m = buf[i];
    let s = 0;
    if (m === ttMove)
      s += 1e7;
    if (isGrabMove(m))
      s += 1e5 + 10 * countAdjacentDots(m, phase === PLACE ? side : side === 1 ? 2 : 1);
    if (m === killers[ply * 2])
      s += 5e4;
    if (m === killers[ply * 2 + 1])
      s += 25e3;
    s += history[histIdx(side, phaseIdx, m)] | 0;
    scoreBuf[i] = s;
  }
  for (let i = 1; i < n; i++) {
    const m = buf[i], s = scoreBuf[i];
    let j = i - 1;
    while (j >= 0 && scoreBuf[j] < s) {
      buf[j + 1] = buf[j];
      scoreBuf[j + 1] = scoreBuf[j];
      j--;
    }
    buf[j + 1] = m;
    scoreBuf[j + 1] = s;
  }
}
__name(orderMoves, "orderMoves");
function ttKey() {
  return `${hashLo >>> 0}_${hashHi >>> 0}`;
}
__name(ttKey, "ttKey");
function ttStore(key, depth, value, flag, move) {
  if (tt.size > TT_CAP) {
    const target = TT_CAP * 0.75 | 0;
    let toDrop = tt.size - target;
    for (const k of tt.keys()) {
      if (toDrop-- <= 0)
        break;
      tt.delete(k);
    }
  }
  tt.set(key, { depth, value, flag, move });
}
__name(ttStore, "ttStore");
function negamax(depth, alpha, beta, ply) {
  if (timedOut)
    return 0;
  if (performance.now() >= deadline) {
    timedOut = true;
    return 0;
  }
  if (ply >= MAX_PLY - 1)
    return evaluate();
  const buf = moveBufs[ply];
  let n;
  const wasPhase = phase;
  if (wasPhase === PLACE) {
    n = genPlacements(buf);
    if (n === 0) {
      const diff = biggestGroup(side) - biggestGroup(side === 1 ? 2 : 1);
      const sgn = diff > 0 ? 1 : diff < 0 ? -1 : 0;
      return sgn * WIN_MAG + diff - ply;
    }
  } else {
    n = genEliminations(buf, lastIdx);
    if (n === 0)
      return evaluate();
  }
  const key = ttKey();
  const e = tt.get(key);
  let ttMove = -1;
  if (e && e.depth >= depth && e.depth !== ENDGAME_TT_DEPTH) {
    if (e.flag === FLAG_EXACT)
      return e.value;
    if (e.flag === FLAG_LOWER && e.value >= beta)
      return e.value;
    if (e.flag === FLAG_UPPER && e.value <= alpha)
      return e.value;
  }
  if (e)
    ttMove = e.move;
  if (depth <= 0)
    return evaluate();
  orderMoves(buf, n, ttMove, ply);
  let best = -INF;
  let bestMove = -1;
  const aOrig = alpha;
  for (let i = 0; i < n; i++) {
    const m = buf[i];
    const savedLastIdx = lastIdx;
    if (wasPhase === PLACE)
      applyPlace(m);
    else
      applyEliminate(m);
    let v;
    if (wasPhase === PLACE)
      v = negamax(depth - 1, alpha, beta, ply + 1);
    else
      v = -negamax(depth - 1, -beta, -alpha, ply + 1);
    if (wasPhase === PLACE)
      undoPlace(m);
    else
      undoEliminate(m, savedLastIdx);
    if (timedOut)
      return 0;
    if (v > best) {
      best = v;
      bestMove = m;
    }
    if (v > alpha)
      alpha = v;
    if (alpha >= beta) {
      if (!isGrabMove(m)) {
        pushKiller(ply, m);
        bumpHistory(side, wasPhase === PLACE ? 0 : 1, m, depth);
      }
      break;
    }
  }
  const flag = best <= aOrig ? FLAG_UPPER : best >= beta ? FLAG_LOWER : FLAG_EXACT;
  ttStore(key, depth, best, flag, bestMove);
  return best;
}
__name(negamax, "negamax");
function searchRoot(depth) {
  const buf = moveBufs[0];
  const wasPhase = phase;
  let n;
  if (wasPhase === PLACE)
    n = genPlacements(buf);
  else
    n = genEliminations(buf, lastIdx);
  if (n === 0)
    return null;
  const key = ttKey();
  const e = tt.get(key);
  const ttMove = e && e.move >= 0 ? e.move : -1;
  orderMoves(buf, n, ttMove, 0);
  let best = -INF;
  let bestMove = -1;
  const scores = /* @__PURE__ */ new Map();
  for (let i = 0; i < n; i++) {
    const m = buf[i];
    const savedLastIdx = lastIdx;
    if (wasPhase === PLACE)
      applyPlace(m);
    else
      applyEliminate(m);
    let v;
    if (wasPhase === PLACE)
      v = negamax(depth - 1, -INF, INF, 1);
    else
      v = -negamax(depth - 1, -INF, INF, 1);
    if (wasPhase === PLACE)
      undoPlace(m);
    else
      undoEliminate(m, savedLastIdx);
    if (timedOut)
      return null;
    scores.set(m, v);
    if (v > best) {
      best = v;
      bestMove = m;
    }
  }
  return { bestMove, bestValue: best, scores };
}
__name(searchRoot, "searchRoot");
function runFixedAB(depth, timeMsCap) {
  deadline = performance.now() + (timeMsCap || 1e4);
  timedOut = false;
  const r = searchRoot(depth);
  if (timedOut)
    return null;
  return r;
}
__name(runFixedAB, "runFixedAB");
function runOnePly() {
  const buf = moveBufs[0];
  const wasPhase = phase;
  const n = wasPhase === PLACE ? genPlacements(buf) : genEliminations(buf, lastIdx);
  if (n === 0)
    return null;
  const scores = /* @__PURE__ */ new Map();
  for (let i = 0; i < n; i++) {
    const m = buf[i];
    const savedLastIdx = lastIdx;
    if (wasPhase === PLACE)
      applyPlace(m);
    else
      applyEliminate(m);
    const raw = evaluate();
    const v = wasPhase === PLACE ? raw : -raw;
    if (wasPhase === PLACE)
      undoPlace(m);
    else
      undoEliminate(m, savedLastIdx);
    scores.set(m, v);
  }
  let best = -INF;
  for (const v of scores.values())
    if (v > best)
      best = v;
  return { bestMove: null, bestValue: best, scores };
}
__name(runOnePly, "runOnePly");
function endgameNegamax(alpha, beta, ply) {
  if (timedOut)
    return 0;
  if (performance.now() >= deadline) {
    timedOut = true;
    return 0;
  }
  if (ply >= MAX_PLY - 1) {
    return biggestGroup(side) - biggestGroup(side === 1 ? 2 : 1);
  }
  const buf = moveBufs[ply];
  let n;
  const wasPhase = phase;
  if (wasPhase === PLACE) {
    n = genPlacements(buf);
    if (n === 0)
      return biggestGroup(side) - biggestGroup(side === 1 ? 2 : 1);
  } else {
    n = genEliminations(buf, lastIdx);
    if (n === 0)
      return biggestGroup(side) - biggestGroup(side === 1 ? 2 : 1);
  }
  const key = ttKey();
  const e = tt.get(key);
  let ttMove = -1;
  if (e && e.depth === ENDGAME_TT_DEPTH) {
    if (e.flag === FLAG_EXACT)
      return e.value;
    if (e.flag === FLAG_LOWER && e.value >= beta)
      return e.value;
    if (e.flag === FLAG_UPPER && e.value <= alpha)
      return e.value;
  }
  if (e)
    ttMove = e.move;
  orderMoves(buf, n, ttMove, ply);
  let best = -INF;
  let bestMove = -1;
  const aOrig = alpha;
  for (let i = 0; i < n; i++) {
    const m = buf[i];
    const savedLastIdx = lastIdx;
    if (wasPhase === PLACE)
      applyPlace(m);
    else
      applyEliminate(m);
    let v;
    if (wasPhase === PLACE)
      v = endgameNegamax(alpha, beta, ply + 1);
    else
      v = -endgameNegamax(-beta, -alpha, ply + 1);
    if (wasPhase === PLACE)
      undoPlace(m);
    else
      undoEliminate(m, savedLastIdx);
    if (timedOut)
      return 0;
    if (v > best) {
      best = v;
      bestMove = m;
    }
    if (v > alpha)
      alpha = v;
    if (alpha >= beta)
      break;
  }
  const flag = best <= aOrig ? FLAG_UPPER : best >= beta ? FLAG_LOWER : FLAG_EXACT;
  ttStore(key, ENDGAME_TT_DEPTH, best, flag, bestMove);
  return best;
}
__name(endgameNegamax, "endgameNegamax");
function endgameRoot() {
  const buf = moveBufs[0];
  const wasPhase = phase;
  let n;
  if (wasPhase === PLACE)
    n = genPlacements(buf);
  else
    n = genEliminations(buf, lastIdx);
  if (n === 0)
    return null;
  orderMoves(buf, n, -1, 0);
  let best = -INF;
  let bestMove = -1;
  const scores = /* @__PURE__ */ new Map();
  let alpha = -INF;
  const beta = INF;
  for (let i = 0; i < n; i++) {
    const m = buf[i];
    const savedLastIdx = lastIdx;
    if (wasPhase === PLACE)
      applyPlace(m);
    else
      applyEliminate(m);
    let v;
    if (wasPhase === PLACE)
      v = endgameNegamax(alpha, beta, 1);
    else
      v = -endgameNegamax(-beta, -alpha, 1);
    if (wasPhase === PLACE)
      undoPlace(m);
    else
      undoEliminate(m, savedLastIdx);
    if (timedOut)
      return null;
    scores.set(m, v);
    if (v > best) {
      best = v;
      bestMove = m;
    }
    if (v > alpha)
      alpha = v;
  }
  return { bestMove, bestValue: best, scores };
}
__name(endgameRoot, "endgameRoot");
function runEndgame() {
  const t0 = performance.now();
  deadline = t0 + ENDGAME_SAFETY_MS;
  timedOut = false;
  const result = endgameRoot();
  if (timedOut)
    return null;
  return result;
}
__name(runEndgame, "runEndgame");
function heavyWeight(idx, ph, who) {
  const opp = who === 1 ? 2 : 1;
  if (ph === PLACE) {
    const ownAdj2 = countAdjacentDots(idx, who);
    const oppAdj2 = countAdjacentDots(idx, opp);
    const deadAdj = countAdjacentDead(idx);
    return Math.max(0.1, 1 + 3 * ownAdj2 + 2 * oppAdj2 - 2 * deadAdj);
  }
  const ownAdj = countAdjacentDots(idx, who);
  const oppAdj = countAdjacentDots(idx, opp);
  return Math.max(0.1, 1 + 4 * oppAdj - 2 * ownAdj);
}
__name(heavyWeight, "heavyWeight");
function pickWeighted(arr, n, ph, who) {
  let total = 0;
  for (let i = 0; i < n; i++)
    total += heavyWeight(arr[i], ph, who);
  let r = Math.random() * total;
  for (let i = 0; i < n; i++) {
    const w = heavyWeight(arr[i], ph, who);
    r -= w;
    if (r <= 0)
      return arr[i];
  }
  return arr[n - 1];
}
__name(pickWeighted, "pickWeighted");
function makeMctsNode(parent, move, toMove, nodePhase) {
  return {
    parent,
    move,
    toMove,
    phase: nodePhase,
    untriedSorted: null,
    untriedCount: 0,
    children: null,
    visits: 0,
    totalScore: 0
  };
}
__name(makeMctsNode, "makeMctsNode");
var prevRoot = null;
var prevCellsSnap = null;
var prevDeadSnap = null;
var prevPhaseSnap = 0;
var prevSideSnap = 0;
var prevLastIdxSnap = -1;
var prevSizeSnap = 0;
function discardReuseSnapshot() {
  prevRoot = null;
  prevCellsSnap = null;
  prevDeadSnap = null;
  prevSizeSnap = 0;
}
__name(discardReuseSnapshot, "discardReuseSnapshot");
function _findAdjacentDead(centerIdx, deadIdxs, used) {
  if (centerIdx < 0)
    return -1;
  const cr = centerIdx / size | 0;
  const cc = centerIdx - cr * size;
  for (let i = 0; i < deadIdxs.length; i++) {
    if (used[i])
      continue;
    const d = deadIdxs[i];
    const dr = d / size | 0;
    const dc = d - dr * size;
    const adr = Math.abs(dr - cr);
    const adc = Math.abs(dc - cc);
    if (adr <= 1 && adc <= 1 && (adr !== 0 || adc !== 0)) {
      used[i] = 1;
      return d;
    }
  }
  return -1;
}
__name(_findAdjacentDead, "_findAdjacentDead");
function _computeMoveSequenceForReuse() {
  const newDots = [];
  const newDeadIdxs = [];
  for (let i = 0; i < N2; i++) {
    const wasDot = prevCellsSnap[i] !== 0;
    const isDot = cells[i] !== 0;
    if (wasDot && !isDot)
      return null;
    if (wasDot && isDot && prevCellsSnap[i] !== cells[i])
      return null;
    if (!wasDot && isDot)
      newDots.push({ idx: i, player: cells[i] });
    const wasDead = !!prevDeadSnap[i];
    const isDead = !!dead[i];
    if (wasDead && !isDead)
      return null;
    if (!wasDead && isDead)
      newDeadIdxs.push(i);
  }
  if (newDots.length === 0 && newDeadIdxs.length === 0)
    return [];
  const otherSide = prevSideSnap === 1 ? 2 : 1;
  let myDot = null;
  let oppDot = null;
  for (const d of newDots) {
    if (d.player === prevSideSnap && !myDot)
      myDot = d;
    else if (d.player === otherSide && !oppDot)
      oppDot = d;
  }
  for (const d of newDots)
    if (d !== myDot && d !== oppDot)
      return null;
  const usedDead = new Uint8Array(newDeadIdxs.length);
  const moves = [];
  if (prevPhaseSnap === PLACE) {
    if (myDot) {
      moves.push(myDot.idx);
      const myDead = _findAdjacentDead(myDot.idx, newDeadIdxs, usedDead);
      if (myDead >= 0)
        moves.push(myDead);
    }
    if (oppDot) {
      moves.push(oppDot.idx);
      const oppDead = _findAdjacentDead(oppDot.idx, newDeadIdxs, usedDead);
      if (oppDead >= 0)
        moves.push(oppDead);
    }
  } else {
    if (prevLastIdxSnap >= 0) {
      const myDead = _findAdjacentDead(prevLastIdxSnap, newDeadIdxs, usedDead);
      if (myDead >= 0)
        moves.push(myDead);
    }
    if (oppDot) {
      moves.push(oppDot.idx);
      const oppDead = _findAdjacentDead(oppDot.idx, newDeadIdxs, usedDead);
      if (oppDead >= 0)
        moves.push(oppDead);
    }
  }
  for (let i = 0; i < usedDead.length; i++)
    if (!usedDead[i])
      return null;
  return moves;
}
__name(_computeMoveSequenceForReuse, "_computeMoveSequenceForReuse");
function _navigateTreeForReuse() {
  if (!prevRoot || !prevCellsSnap || prevSizeSnap !== size)
    return null;
  const moves = _computeMoveSequenceForReuse();
  if (moves === null)
    return null;
  let node = prevRoot;
  for (let i = 0; i < moves.length; i++) {
    if (!node.children || node.children.length === 0)
      return null;
    let found = null;
    for (let j = 0; j < node.children.length; j++) {
      if (node.children[j].move === moves[i]) {
        found = node.children[j];
        break;
      }
    }
    if (!found)
      return null;
    node = found;
  }
  if (node.toMove !== side || node.phase !== phase)
    return null;
  return node;
}
__name(_navigateTreeForReuse, "_navigateTreeForReuse");
var mctsGenBuf = null;
function ensureUntried(node) {
  if (node.untriedSorted !== null)
    return;
  const buf = mctsGenBuf;
  const n = node.phase === PLACE ? genPlacements(buf) : genEliminations(buf, lastIdx);
  if (n === 0) {
    node.untriedSorted = new Int16Array(0);
    node.untriedCount = 0;
    node.children = [];
    return;
  }
  for (let i = 0; i < n; i++) {
    scoreBuf[i] = Math.round(heavyWeight(buf[i], node.phase, node.toMove) * 1e3) | 0;
  }
  for (let i = 1; i < n; i++) {
    const m = buf[i], s = scoreBuf[i];
    let j = i - 1;
    while (j >= 0 && scoreBuf[j] < s) {
      buf[j + 1] = buf[j];
      scoreBuf[j + 1] = scoreBuf[j];
      j--;
    }
    buf[j + 1] = m;
    scoreBuf[j + 1] = s;
  }
  node.untriedSorted = buf.slice(0, n);
  node.untriedCount = n;
  node.children = [];
}
__name(ensureUntried, "ensureUntried");
var raveKEff = RAVE_K;
var mctsCEff = MCTS_C;
var pwAlphaEff = PW_ALPHA;
var rolloutShortcutEff = false;
var amafScore = null;
var amafVisits = null;
var amafSeen = null;
var amafSeenList = null;
var amafSeenCount = 0;
function amafIdx(s, ph, m) {
  return ((s - 1) * 2 + ph) * N2 + m;
}
__name(amafIdx, "amafIdx");
function amafTouch(s, ph, m) {
  const i = amafIdx(s, ph, m);
  if (!amafSeen[i]) {
    amafSeen[i] = 1;
    amafSeenList[amafSeenCount++] = i;
  }
}
__name(amafTouch, "amafTouch");
function amafResetSeen() {
  for (let k = 0; k < amafSeenCount; k++)
    amafSeen[amafSeenList[k]] = 0;
  amafSeenCount = 0;
}
__name(amafResetSeen, "amafResetSeen");
function uctRaveScore(child, parent) {
  const cv = child.visits;
  if (cv === 0)
    return Infinity;
  const uctMean = child.toMove === parent.toMove ? child.totalScore / cv : -child.totalScore / cv;
  const ai = amafIdx(parent.toMove, parent.phase, child.move);
  const av = amafVisits[ai];
  const amafMean = av > 0 ? amafScore[ai] / av : 0;
  const beta = raveKEff > 0 ? Math.sqrt(raveKEff / (3 * cv + raveKEff)) : 0;
  const exploit = (1 - beta) * uctMean + beta * amafMean;
  const explore = mctsCEff * Math.sqrt(Math.log(parent.visits) / cv);
  return exploit + explore;
}
__name(uctRaveScore, "uctRaveScore");
function expandOne(node) {
  const m = node.untriedSorted[0];
  for (let i = 1; i < node.untriedCount; i++)
    node.untriedSorted[i - 1] = node.untriedSorted[i];
  node.untriedCount--;
  const wasPhase = phase;
  const savedLastIdx = lastIdx;
  if (wasPhase === PLACE)
    applyPlace(m);
  else
    applyEliminate(m);
  const child = makeMctsNode(node, m, side, phase);
  node.children.push(child);
  return { child, move: m, wasPhase, savedLastIdx };
}
__name(expandOne, "expandOne");
var mctsSelStack = [];
var mctsRollStack = [];
function runOneMctsSim(root) {
  mctsSelStack.length = 0;
  mctsRollStack.length = 0;
  amafResetSeen();
  let node = root;
  let path = [root];
  while (true) {
    ensureUntried(node);
    if (node.untriedCount === 0 && node.children.length === 0)
      break;
    const cap = Math.max(1, Math.ceil(Math.pow(Math.max(1, node.visits), pwAlphaEff)));
    if (node.children.length < cap && node.untriedCount > 0) {
      const r = expandOne(node);
      mctsSelStack.push({ move: r.move, wasPhase: r.wasPhase, savedLastIdx: r.savedLastIdx });
      amafTouch(node.toMove, r.wasPhase, r.move);
      path.push(r.child);
      node = r.child;
      break;
    }
    let best = -Infinity;
    let bestChild = null;
    for (const c of node.children) {
      const sc = uctRaveScore(c, node);
      if (sc > best) {
        best = sc;
        bestChild = c;
      }
    }
    if (bestChild === null)
      break;
    const wasPhase = phase;
    const savedLastIdx = lastIdx;
    if (wasPhase === PLACE)
      applyPlace(bestChild.move);
    else
      applyEliminate(bestChild.move);
    mctsSelStack.push({ move: bestChild.move, wasPhase, savedLastIdx });
    amafTouch(node.toMove, wasPhase, bestChild.move);
    node = bestChild;
    path.push(node);
  }
  const ROLL_CAP = 2 * N2;
  const SHORTCUT_INTERVAL = 4;
  const SHORTCUT_MAX_FREE = 30;
  let plyCount = 0;
  let earlyResult = null;
  while (plyCount < ROLL_CAP) {
    const buf = moveBufs[0];
    let n;
    const wasPhase = phase;
    if (wasPhase === PLACE)
      n = genPlacements(buf);
    else
      n = genEliminations(buf, lastIdx);
    if (n === 0)
      break;
    const m = pickWeighted(buf, n, wasPhase, side);
    const savedLastIdx = lastIdx;
    if (wasPhase === PLACE)
      applyPlace(m);
    else
      applyEliminate(m);
    mctsRollStack.push({ move: m, wasPhase, savedLastIdx });
    amafTouch(wasPhase === PLACE ? side : side === 1 ? 2 : 1, wasPhase, m);
    plyCount++;
    if (rolloutShortcutEff && plyCount % SHORTCUT_INTERVAL === 0) {
      const free = countEmpty();
      if (free > 0 && free <= SHORTCUT_MAX_FREE) {
        const big1 = biggestGroup(1);
        const big2 = biggestGroup(2);
        const maxNew = Math.ceil(free / 4);
        if (big1 + maxNew < big2) {
          earlyResult = side === 2 ? 1 : -1;
          break;
        } else if (big2 + maxNew < big1) {
          earlyResult = side === 1 ? 1 : -1;
          break;
        }
      }
    }
  }
  let leafResult;
  if (earlyResult !== null) {
    leafResult = earlyResult;
  } else {
    const myFinal = biggestGroup(side);
    const opFinal = biggestGroup(side === 1 ? 2 : 1);
    leafResult = myFinal > opFinal ? 1 : myFinal < opFinal ? -1 : 0;
  }
  let s = leafResult;
  for (let i = path.length - 1; i >= 0; i--) {
    const n = path[i];
    n.visits++;
    n.totalScore += s;
    if (i > 0) {
      const parent = path[i - 1];
      if (parent.toMove !== n.toMove)
        s = -s;
    }
  }
  const leafSide = side;
  for (let k = 0; k < amafSeenCount; k++) {
    const idx = amafSeenList[k];
    const mover = (idx / N2 | 0) >> 1;
    const moverSide = mover + 1;
    const sign = moverSide === leafSide ? 1 : -1;
    amafScore[idx] += sign * leafResult;
    amafVisits[idx] += 1;
  }
  while (mctsRollStack.length > 0) {
    const { move: m, wasPhase, savedLastIdx } = mctsRollStack.pop();
    if (wasPhase === PLACE)
      undoPlace(m);
    else
      undoEliminate(m, savedLastIdx);
  }
  while (mctsSelStack.length > 0) {
    const { move: m, wasPhase, savedLastIdx } = mctsSelStack.pop();
    if (wasPhase === PLACE)
      undoPlace(m);
    else
      undoEliminate(m, savedLastIdx);
  }
}
__name(runOneMctsSim, "runOneMctsSim");
var MCTS_YIELD_BATCH = 1e3;
async function runMCTSRave(cfg) {
  const wallStart = Date.now();
  raveKEff = Number.isFinite(Number(cfg.raveK)) ? Number(cfg.raveK) : RAVE_K;
  mctsCEff = Number.isFinite(Number(cfg.mctsC)) ? Number(cfg.mctsC) : MCTS_C;
  pwAlphaEff = Number.isFinite(Number(cfg.pwAlpha)) ? Number(cfg.pwAlpha) : PW_ALPHA;
  rolloutShortcutEff = !!cfg.rolloutShortcut;
  let root = null;
  let reused = false;
  if (cfg.reuseTree && prevRoot) {
    const navigated = _navigateTreeForReuse();
    if (navigated) {
      root = navigated;
      root.parent = null;
      reused = true;
    } else {
      discardReuseSnapshot();
    }
  }
  if (!reused)
    root = makeMctsNode(null, -1, side, phase);
  amafScore = new Float64Array(4 * N2);
  amafVisits = new Int32Array(4 * N2);
  amafSeen = new Uint8Array(4 * N2);
  amafSeenList = new Int32Array(4 * N2);
  amafSeenCount = 0;
  const wallDeadline = Date.now() + (cfg.timeMs || 22e3);
  timedOut = false;
  let sims = 0;
  const cap = cfg.simBudget || 1e5;
  while (sims < cap) {
    const batchEnd = Math.min(cap, sims + MCTS_YIELD_BATCH);
    while (sims < batchEnd) {
      runOneMctsSim(root);
      sims++;
    }
    await new Promise((r) => setTimeout(r, 0));
    if (Date.now() >= wallDeadline) {
      timedOut = true;
      break;
    }
  }
  const wallMs = Date.now() - wallStart;
  const childCount = root.children ? root.children.length : 0;
  console.log(
    `[aiEngine] runMCTSRave done: sims=${sims} cap=${cap} timeMs=${cfg.timeMs} wall=${wallMs}ms rootChildren=${childCount} timedOut=${timedOut} reused=${reused} side=${side} phase=${phase === 0 ? "PLACE" : "ELIM"}`
  );
  if (!root.children || root.children.length === 0) {
    if (cfg.reuseTree)
      discardReuseSnapshot();
    console.warn(`[aiEngine] runMCTSRave returning NULL \u2014 root has no children after ${sims} sims`);
    return null;
  }
  let bestChild = root.children[0];
  for (const c of root.children) {
    if (c.visits > bestChild.visits)
      bestChild = c;
  }
  const scores = /* @__PURE__ */ new Map();
  for (const c of root.children)
    scores.set(c.move, c.visits);
  if (cfg.reuseTree) {
    prevRoot = root;
    prevCellsSnap = new Int8Array(cells);
    prevDeadSnap = new Uint8Array(dead);
    prevPhaseSnap = phase;
    prevSideSnap = side;
    prevLastIdxSnap = lastIdx;
    prevSizeSnap = size;
  }
  return { bestMove: bestChild.move, bestValue: bestChild.visits, scores };
}
__name(runMCTSRave, "runMCTSRave");
function pickEps(scores, eps, epsMin) {
  if (!scores || scores.size === 0)
    return null;
  let best = -INF;
  for (const v of scores.values())
    if (v > best)
      best = v;
  const tol = Math.max(epsMin, Math.abs(best) * eps);
  const pool = [];
  for (const [m, v] of scores) {
    if (v >= best - tol)
      pool.push(m);
  }
  if (pool.length === 0)
    return null;
  return pool[Math.floor(Math.random() * pool.length)];
}
__name(pickEps, "pickEps");
function countEmpty() {
  let n = 0;
  for (let i = 0; i < N2; i++)
    if (cells[i] === 0 && !dead[i])
      n++;
  return n;
}
__name(countEmpty, "countEmpty");
async function chooseMove(cfg) {
  currentEval = EVAL_BY_NAME[cfg.evalName] || evalBasic;
  const endgameThreshold = Number.isFinite(Number(cfg.endgameDepth)) ? Number(cfg.endgameDepth) : ENDGAME_THRESHOLD;
  if (cfg.kind === "oneply") {
    const r = runOnePly();
    return pickEps(r?.scores, 0, 0);
  }
  if (cfg.kind === "fixedab") {
    if (cfg.endgame && countEmpty() <= endgameThreshold) {
      const eg = runEndgame();
      if (eg)
        return pickEps(eg.scores, 0, 0);
    }
    const r = runFixedAB(cfg.depth, cfg.timeMs);
    return pickEps(r?.scores, 0, 0);
  }
  if (cfg.kind === "mctsrave") {
    if (cfg.endgame && countEmpty() <= endgameThreshold) {
      const r2 = runEndgame();
      if (r2)
        return pickEps(r2.scores, 0, 0);
    }
    let effCfg = cfg;
    if (phase === ELIMINATE) {
      const baseSims = cfg.simBudget || 1e5;
      const baseTime = cfg.timeMs || 22e3;
      effCfg = {
        ...cfg,
        simBudget: Math.min(baseSims, Math.max(500, Math.floor(baseSims / 4))),
        timeMs: Math.min(baseTime, Math.max(1500, Math.floor(baseTime / 3)))
      };
    }
    const r = await runMCTSRave(effCfg);
    return pickEps(r?.scores, 0, 0);
  }
  return null;
}
__name(chooseMove, "chooseMove");
function initFromState(stateInput, gridSize, pPhase, lastPlaces, currentPlayer) {
  size = gridSize;
  N2 = size * size;
  cells = new Int8Array(N2);
  dead = new Uint8Array(N2);
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      const idx = r * size + c;
      const cell = stateInput[r][c];
      cells[idx] = cell.player === 1 ? 1 : cell.player === 2 ? 2 : 0;
      dead[idx] = cell.eliminated ? 1 : 0;
    }
  }
  phase = pPhase === "eliminate" ? ELIMINATE : PLACE;
  side = currentPlayer === 2 ? 2 : 1;
  lastIdx = phase === ELIMINATE && lastPlaces ? lastPlaces.row * size + lastPlaces.col : -1;
  ensureZobrist();
  computeInitialHash();
  tt = /* @__PURE__ */ new Map();
  history = new Float64Array(2 * 2 * N2);
  killers = new Int16Array(MAX_PLY * 2);
  killers.fill(-1);
  moveBufs = new Array(MAX_PLY);
  for (let p = 0; p < MAX_PLY; p++)
    moveBufs[p] = new Int16Array(N2);
  scoreBuf = new Int32Array(N2);
  visitedBuf = new Uint8Array(N2);
  stackBuf = new Int16Array(N2);
  frontierBuf = new Uint8Array(N2);
  mctsGenBuf = new Int16Array(N2);
  timedOut = false;
}
__name(initFromState, "initFromState");
async function chooseAIMove({ tier, state: stateInput, size: gridSize, phase: pPhase, lastPlaces, currentPlayer }) {
  const cfg = AI_TIERS[tier];
  if (!cfg)
    return null;
  initFromState(stateInput, gridSize, pPhase, lastPlaces, currentPlayer);
  const moveIdx = await chooseMove(cfg);
  if (moveIdx === null || moveIdx === void 0 || moveIdx < 0)
    return null;
  const r = moveIdx / size | 0;
  const c = moveIdx - r * size;
  return { row: r, col: c };
}
__name(chooseAIMove, "chooseAIMove");

// src/index.js
var FIREBASE_CERTS_URL = "https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com";
var FIREBASE_TOKEN_URL = "https://oauth2.googleapis.com/token";
var FIRESTORE_SCOPE = "https://www.googleapis.com/auth/datastore";
var ALLOWED_ORIGIN_HOSTS = /* @__PURE__ */ new Set([
  "collector-braingame.web.app",
  "collector-braingame.firebaseapp.com",
  "localhost",
  "127.0.0.1"
]);
var CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS"
};
var DEFAULT_MU = 1500;
var DEFAULT_SIGMA2 = 500;
var DEFAULT_DISPLAY_RATING = 1e3;
var OPEN_SKILL_BETA = 250;
var DISPLAY_SCALE = 1e3 / Math.LN2;
var DISPLAY_DIVISOR2 = 2485;
var MIN_SIGMA = 1;
var EPSILON = 1e-12;
var MAX_MU2 = 5e3;
var MAX_DISPLAY_RATING = 9999;
var MATCHMAKING_STALE_MS_BY_MODE = {
  ranked: 25 * 1e3,
  standard: 30 * 1e3
};
var MATCHMAKING_STALE_MS = 30 * 1e3;
var STALE_GAME_THRESHOLD_MS = 60 * 1e3;
var STALE_STANDARD_GAME_THRESHOLD_MS = 5 * 60 * 1e3;
var TURN_DURATION_MS = 30 * 1e3;
var TURN_DEADLINE_GRACE_MS = 2 * 1e3;
var QUEUE_QUERY_LIMIT = 200;
var ACTIVE_GAME_QUERY_LIMIT = 5;
var MATCHMAKING_POOL_DIVISOR = 10;
var MATCHMAKING_POOL_MAX = 1e3;
var ALLOWED_GRID_SIZES = /* @__PURE__ */ new Set([4, 6, 8, 10, 12]);
var RANKED_GRID_SIZE = 8;
var ROOM_CODE_PATTERN = /^[A-Z0-9]{6}$/;
var GAME_ID_PATTERN = /^[A-Za-z0-9_]{1,40}$/;
var MAX_DISPLAY_NAME_LENGTH = 32;
var DANGEROUS_NAME_CHARS = new RegExp(
  "[\\u00AD\\u061C\\u180E\\u200B-\\u200F\\u202A-\\u202E\\u2060-\\u2064\\u2066-\\u206F\\uFE00-\\uFE0F\\uFEFF]|[\\u{E0000}-\\u{E007F}]",
  // tag characters (extra range needs its own class)
  "gu"
);
var CONTROL_CHARS = /[\x00-\x1F\x7F-\x9F]/g;
var HttpError = class extends Error {
  constructor(message2, status = 400) {
    super(message2);
    this.status = status;
    this.exposed = true;
  }
};
__name(HttpError, "HttpError");
function clampDisplayName(name) {
  if (typeof name !== "string")
    return "";
  const cleaned = name.normalize("NFKC").replace(DANGEROUS_NAME_CHARS, "").replace(CONTROL_CHARS, "").replace(/\s+/g, " ").trim();
  return cleaned.slice(0, MAX_DISPLAY_NAME_LENGTH);
}
__name(clampDisplayName, "clampDisplayName");
function parseGridSize(raw, { fallback = 6 } = {}) {
  const n = Number(raw);
  return ALLOWED_GRID_SIZES.has(n) ? n : fallback;
}
__name(parseGridSize, "parseGridSize");
function requireGridSize(raw) {
  const n = Number(raw);
  if (!ALLOWED_GRID_SIZES.has(n)) {
    throw new HttpError("Invalid grid size.", 400);
  }
  return n;
}
__name(requireGridSize, "requireGridSize");
function requireRoomCode(raw) {
  const code = String(raw || "").toUpperCase().trim();
  if (!ROOM_CODE_PATTERN.test(code)) {
    throw new HttpError("Room code is required.", 400);
  }
  return code;
}
__name(requireRoomCode, "requireRoomCode");
function requireGameId(raw) {
  const id = String(raw || "");
  if (!GAME_ID_PATTERN.test(id)) {
    throw new HttpError("gameId is required.", 400);
  }
  return id;
}
__name(requireGameId, "requireGameId");
function requireBoardIndex(raw, size2, label) {
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0 || n >= size2) {
    throw new HttpError(`Invalid ${label}.`, 400);
  }
  return n;
}
__name(requireBoardIndex, "requireBoardIndex");
var certCache = null;
var certCacheExpiresAt = 0;
var googleTokenCache = null;
var googleTokenExpiresAt = 0;
var pkcs8KeyPromise = null;
function corsResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...CORS_HEADERS,
      "Content-Type": "application/json; charset=utf-8"
    }
  });
}
__name(corsResponse, "corsResponse");
function errorResponse(message2, status = 400) {
  return corsResponse({ error: message2 }, status);
}
__name(errorResponse, "errorResponse");
function base64UrlEncode(bytes) {
  let str = "";
  bytes.forEach((byte) => {
    str += String.fromCharCode(byte);
  });
  return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
__name(base64UrlEncode, "base64UrlEncode");
function jsonToBase64Url(json) {
  return base64UrlEncode(new TextEncoder().encode(JSON.stringify(json)));
}
__name(jsonToBase64Url, "jsonToBase64Url");
function isAllowedEmail(email) {
  return typeof email === "string" && email.toLowerCase().endsWith("@gmail.com");
}
__name(isAllowedEmail, "isAllowedEmail");
function normalizeMode(mode) {
  return mode === "ranked" ? "ranked" : "standard";
}
__name(normalizeMode, "normalizeMode");
function matchmakingCollection(mode) {
  return mode === "ranked" ? "matchmakingQueue_ranked" : "matchmakingQueue_standard";
}
__name(matchmakingCollection, "matchmakingCollection");
function buildPlayerName(entry) {
  return entry.displayName || "Player";
}
__name(buildPlayerName, "buildPlayerName");
function createInitialState(size2) {
  const state = [];
  for (let i = 0; i < size2; i += 1) {
    const row = [];
    for (let j = 0; j < size2; j += 1) {
      row.push({ player: null, eliminated: false });
    }
    state.push(row);
  }
  return state;
}
__name(createInitialState, "createInitialState");
function normalizeGameState(gameStateJSON, size2) {
  if (!gameStateJSON)
    return createInitialState(size2);
  try {
    const parsed = JSON.parse(gameStateJSON);
    if (!Array.isArray(parsed) || !parsed.length) {
      return createInitialState(size2);
    }
    return parsed;
  } catch (_) {
    return createInitialState(size2);
  }
}
__name(normalizeGameState, "normalizeGameState");
function deepCopyState(state) {
  return (state || []).map((row) => row.map((cell) => ({ ...cell })));
}
__name(deepCopyState, "deepCopyState");
function hasAdjacentFree(state, size2, row, col) {
  for (let i = -1; i <= 1; i += 1) {
    for (let j = -1; j <= 1; j += 1) {
      if (i === 0 && j === 0)
        continue;
      const r = row + i;
      const c = col + j;
      if (r < 0 || r >= size2 || c < 0 || c >= size2)
        continue;
      const cell = state[r][c];
      if (cell.player === null && !cell.eliminated)
        return true;
    }
  }
  return false;
}
__name(hasAdjacentFree, "hasAdjacentFree");
function isValidPlacement(state, size2, row, col) {
  const cell = state[row]?.[col];
  if (!cell || cell.player !== null || cell.eliminated)
    return false;
  return hasAdjacentFree(state, size2, row, col);
}
__name(isValidPlacement, "isValidPlacement");
function isValidElimination(state, lastPlaces, row, col) {
  if (!lastPlaces)
    return false;
  const cell = state[row]?.[col];
  if (!cell || cell.player !== null || cell.eliminated)
    return false;
  const dr = Math.abs(row - lastPlaces.row);
  const dc = Math.abs(col - lastPlaces.col);
  if (dr > 1 || dc > 1 || dr === 0 && dc === 0)
    return false;
  return true;
}
__name(isValidElimination, "isValidElimination");
function applyPlace2(state, player, row, col) {
  const nextState = deepCopyState(state);
  nextState[row][col].player = player;
  return nextState;
}
__name(applyPlace2, "applyPlace");
function applyEliminate2(state, row, col) {
  const nextState = deepCopyState(state);
  nextState[row][col].eliminated = true;
  return nextState;
}
__name(applyEliminate2, "applyEliminate");
function dfs(state, size2, r, c, player, visited) {
  if (r < 0 || r >= size2 || c < 0 || c >= size2)
    return 0;
  if (visited[r][c])
    return 0;
  if (state[r][c].player !== player)
    return 0;
  visited[r][c] = true;
  let count = 1;
  for (const [dr, dc] of [
    [-1, -1],
    [-1, 0],
    [-1, 1],
    [0, -1],
    [0, 1],
    [1, -1],
    [1, 0],
    [1, 1]
  ]) {
    count += dfs(state, size2, r + dr, c + dc, player, visited);
  }
  return count;
}
__name(dfs, "dfs");
function getBiggestGroup(state, size2, player) {
  const visited = Array.from({ length: size2 }, () => new Array(size2).fill(false));
  let best = 0;
  for (let i = 0; i < size2; i += 1) {
    for (let j = 0; j < size2; j += 1) {
      if (state[i][j].player === player && !visited[i][j]) {
        best = Math.max(best, dfs(state, size2, i, j, player, visited));
      }
    }
  }
  return best;
}
__name(getBiggestGroup, "getBiggestGroup");
function hasAnyValidMove(state, size2) {
  for (let i = 0; i < size2; i += 1) {
    for (let j = 0; j < size2; j += 1) {
      if (state[i][j].player === null && !state[i][j].eliminated) {
        if (hasAdjacentFree(state, size2, i, j))
          return true;
      }
    }
  }
  return false;
}
__name(hasAnyValidMove, "hasAnyValidMove");
function computeGameResult(state, size2) {
  if (hasAnyValidMove(state, size2))
    return null;
  const score1 = getBiggestGroup(state, size2, 1);
  const score2 = getBiggestGroup(state, size2, 2);
  return {
    winner: score1 === score2 ? 0 : score1 > score2 ? 1 : 2,
    score1,
    score2
  };
}
__name(computeGameResult, "computeGameResult");
function erf(x) {
  const sign = Math.sign(x) || 1;
  const absX = Math.abs(x);
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;
  const t = 1 / (1 + p * absX);
  const y = 1 - ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * Math.exp(-absX * absX);
  return sign * y;
}
__name(erf, "erf");
function standardNormalPdf(x) {
  return Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);
}
__name(standardNormalPdf, "standardNormalPdf");
function standardNormalCdf(x) {
  return 0.5 * (1 + erf(x / Math.SQRT2));
}
__name(standardNormalCdf, "standardNormalCdf");
function softplus(x) {
  if (x > 0)
    return x + Math.log1p(Math.exp(-x));
  return Math.log1p(Math.exp(x));
}
__name(softplus, "softplus");
function conservativeSkillFromDisplayRating(displayRating) {
  const normalizedDisplay = Math.max(0, Number(displayRating) || 0);
  const scaled = normalizedDisplay * Math.LN2 / 1e3;
  if (scaled === 0)
    return Number.NEGATIVE_INFINITY;
  return DISPLAY_DIVISOR2 * Math.log(Math.expm1(scaled));
}
__name(conservativeSkillFromDisplayRating, "conservativeSkillFromDisplayRating");
function displayRatingFromConservativeSkill(conservativeSkill) {
  const value = Number(conservativeSkill);
  if (!Number.isFinite(value))
    return DEFAULT_DISPLAY_RATING;
  const raw = DISPLAY_SCALE * softplus(value / DISPLAY_DIVISOR2);
  if (!Number.isFinite(raw))
    return DEFAULT_DISPLAY_RATING;
  return Math.min(MAX_DISPLAY_RATING, Math.max(0, raw));
}
__name(displayRatingFromConservativeSkill, "displayRatingFromConservativeSkill");
function normalizeSkillProfile(profile = {}) {
  const mu = Number(profile.mu);
  const sigma = Number(profile.sigma);
  if (Number.isFinite(mu) && Number.isFinite(sigma)) {
    const clampedMu = Math.min(MAX_MU2, Math.max(0, mu));
    const clampedSigma = Math.min(DEFAULT_SIGMA2, Math.max(MIN_SIGMA, sigma));
    return {
      mu: clampedMu,
      sigma: clampedSigma,
      rating: Math.round(displayRatingFromConservativeSkill(clampedMu - 3 * clampedSigma))
    };
  }
  const legacyRating = Number(profile.rating);
  if (Number.isFinite(legacyRating)) {
    const clampedRating = Math.min(MAX_DISPLAY_RATING, Math.max(0, legacyRating));
    const conservativeSkill = conservativeSkillFromDisplayRating(clampedRating);
    const seedMu = Number.isFinite(conservativeSkill) ? Math.min(MAX_MU2, Math.max(0, conservativeSkill + 3 * DEFAULT_SIGMA2)) : DEFAULT_MU;
    return {
      mu: seedMu,
      sigma: DEFAULT_SIGMA2,
      rating: Math.round(clampedRating)
    };
  }
  return {
    mu: DEFAULT_MU,
    sigma: DEFAULT_SIGMA2,
    rating: DEFAULT_DISPLAY_RATING
  };
}
__name(normalizeSkillProfile, "normalizeSkillProfile");
function computeSkillDelta(profileA, profileB, scoreA) {
  const a = normalizeSkillProfile(profileA);
  const b = normalizeSkillProfile(profileB);
  if (scoreA === 0.5) {
    return {
      delta1: 0,
      delta2: 0,
      newR1: a.rating,
      newR2: b.rating,
      profile1: a,
      profile2: b
    };
  }
  const firstIsWinner = scoreA === 1;
  const winner = firstIsWinner ? a : b;
  const loser = firstIsWinner ? b : a;
  const winnerSigmaSq = winner.sigma ** 2;
  const loserSigmaSq = loser.sigma ** 2;
  const c = Math.sqrt(2 * OPEN_SKILL_BETA ** 2 + winnerSigmaSq + loserSigmaSq);
  const t = (winner.mu - loser.mu) / c;
  const p = Math.max(standardNormalCdf(t), EPSILON);
  const pdf = standardNormalPdf(t);
  const gamma = 1 / c;
  const v = pdf * (t + pdf / p) / p;
  const rawWinnerMu = winner.mu + winnerSigmaSq / c * (pdf / p);
  const rawLoserMu = loser.mu - loserSigmaSq / c * (pdf / p);
  const winnerMu = Number.isFinite(rawWinnerMu) ? Math.min(MAX_MU2, Math.max(0, rawWinnerMu)) : winner.mu;
  const loserMu = Number.isFinite(rawLoserMu) ? Math.min(MAX_MU2, Math.max(0, rawLoserMu)) : loser.mu;
  const winnerSigma = Math.sqrt(Math.max(winnerSigmaSq * (1 - winnerSigmaSq * gamma * gamma * v), MIN_SIGMA ** 2));
  const loserSigma = Math.sqrt(Math.max(loserSigmaSq * (1 - loserSigmaSq * gamma * gamma * v), MIN_SIGMA ** 2));
  const winnerProfile = {
    mu: winnerMu,
    sigma: winnerSigma,
    rating: Math.round(displayRatingFromConservativeSkill(winnerMu - 3 * winnerSigma))
  };
  const loserProfile = {
    mu: loserMu,
    sigma: loserSigma,
    rating: Math.round(displayRatingFromConservativeSkill(loserMu - 3 * loserSigma))
  };
  const profile1 = firstIsWinner ? winnerProfile : loserProfile;
  const profile2 = firstIsWinner ? loserProfile : winnerProfile;
  return {
    delta1: profile1.rating - a.rating,
    delta2: profile2.rating - b.rating,
    newR1: profile1.rating,
    newR2: profile2.rating,
    profile1,
    profile2
  };
}
__name(computeSkillDelta, "computeSkillDelta");
function historyToArray(history2) {
  if (Array.isArray(history2)) {
    return history2.map((point) => {
      if (Array.isArray(point) && point.length === 2) {
        return { r: point[0], c: point[1] };
      }
      if (point && Number.isInteger(point.r) && Number.isInteger(point.c)) {
        return { r: point.r, c: point.c };
      }
      if (point && Number.isInteger(point.row) && Number.isInteger(point.col)) {
        return { r: point.row, c: point.col };
      }
      return null;
    }).filter(Boolean);
  }
  return [];
}
__name(historyToArray, "historyToArray");
function getQueueEntryAgeMs(entry) {
  const data = entry?.data || {};
  const timestamp = Number(data.updatedAtMs || data.joinedAtMs || Date.parse(data.updatedAt || data.joinedAt || "") || 0);
  return Number.isFinite(timestamp) ? Date.now() - timestamp : Number.POSITIVE_INFINITY;
}
__name(getQueueEntryAgeMs, "getQueueEntryAgeMs");
function isFreshQueueEntry(entry) {
  const mode = normalizeMode(entry?.data?.mode);
  const staleMs = MATCHMAKING_STALE_MS_BY_MODE[mode] || MATCHMAKING_STALE_MS;
  return getQueueEntryAgeMs(entry) <= staleMs;
}
__name(isFreshQueueEntry, "isFreshQueueEntry");
function docPath(collectionName, id) {
  return `/${collectionName}/${id}`;
}
__name(docPath, "docPath");
function firestoreValue(value) {
  if (value === null || value === void 0)
    return { nullValue: null };
  if (typeof value === "string")
    return { stringValue: value };
  if (typeof value === "boolean")
    return { booleanValue: value };
  if (typeof value === "number") {
    if (Number.isInteger(value))
      return { integerValue: String(value) };
    return { doubleValue: value };
  }
  if (value instanceof Date)
    return { timestampValue: value.toISOString() };
  if (Array.isArray(value)) {
    return {
      arrayValue: {
        values: value.map((item) => firestoreValue(item))
      }
    };
  }
  if (typeof value === "object") {
    const fields = {};
    Object.entries(value).forEach(([key, val]) => {
      if (val !== void 0)
        fields[key] = firestoreValue(val);
    });
    return { mapValue: { fields } };
  }
  return { stringValue: String(value) };
}
__name(firestoreValue, "firestoreValue");
function firestoreFieldsFromObject(obj = {}) {
  const fields = {};
  Object.entries(obj).forEach(([key, value]) => {
    if (value !== void 0)
      fields[key] = firestoreValue(value);
  });
  return fields;
}
__name(firestoreFieldsFromObject, "firestoreFieldsFromObject");
function firestoreObjectFromFields(fields = {}) {
  const result = {};
  Object.entries(fields).forEach(([key, value]) => {
    result[key] = firestoreValueToJs(value);
  });
  return result;
}
__name(firestoreObjectFromFields, "firestoreObjectFromFields");
function firestoreValueToJs(value) {
  if (value == null)
    return null;
  if ("nullValue" in value)
    return null;
  if ("stringValue" in value)
    return value.stringValue;
  if ("booleanValue" in value)
    return value.booleanValue;
  if ("integerValue" in value)
    return Number(value.integerValue);
  if ("doubleValue" in value)
    return Number(value.doubleValue);
  if ("timestampValue" in value)
    return value.timestampValue;
  if ("arrayValue" in value) {
    return (value.arrayValue?.values || []).map((entry) => firestoreValueToJs(entry));
  }
  if ("mapValue" in value) {
    return firestoreObjectFromFields(value.mapValue?.fields || {});
  }
  return null;
}
__name(firestoreValueToJs, "firestoreValueToJs");
async function getGoogleAccessToken(env) {
  if (googleTokenCache && Date.now() < googleTokenExpiresAt - 6e4) {
    return googleTokenCache;
  }
  const privateKey = env.FIREBASE_PRIVATE_KEY;
  const clientEmail = env.FIREBASE_CLIENT_EMAIL;
  if (!privateKey || !clientEmail) {
    throw new Error("Missing Cloudflare worker secrets for Firebase service account.");
  }
  const assertion = await createServiceAccountJwt(env, clientEmail, privateKey);
  const response = await fetch(FIREBASE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion
    })
  });
  if (!response.ok) {
    throw new Error(`Failed to obtain Google access token: ${response.status}`);
  }
  const data = await response.json();
  googleTokenCache = data.access_token;
  googleTokenExpiresAt = Date.now() + Number(data.expires_in || 0) * 1e3;
  return googleTokenCache;
}
__name(getGoogleAccessToken, "getGoogleAccessToken");
async function createServiceAccountJwt(env, clientEmail, privateKeyPem) {
  if (!pkcs8KeyPromise) {
    const pkcs8 = pemToArrayBuffer(privateKeyPem);
    pkcs8KeyPromise = crypto.subtle.importKey(
      "pkcs8",
      pkcs8,
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["sign"]
    );
  }
  const now = Math.floor(Date.now() / 1e3);
  const header = { alg: "RS256", typ: "JWT" };
  const payload = {
    iss: clientEmail,
    scope: FIRESTORE_SCOPE,
    aud: FIREBASE_TOKEN_URL,
    iat: now,
    exp: now + 3600,
    sub: clientEmail
  };
  const encoder2 = new TextEncoder();
  const signingInput = `${jsonToBase64Url(header)}.${jsonToBase64Url(payload)}`;
  const key = await pkcs8KeyPromise;
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, encoder2.encode(signingInput));
  return `${signingInput}.${base64UrlEncode(new Uint8Array(signature))}`;
}
__name(createServiceAccountJwt, "createServiceAccountJwt");
function pemToArrayBuffer(pem) {
  const normalized = pem.replace(/\\n/g, "\n").replace(/-----BEGIN PRIVATE KEY-----/, "").replace(/-----END PRIVATE KEY-----/, "").replace(/\s+/g, "");
  const binary = atob(normalized);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1)
    bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}
__name(pemToArrayBuffer, "pemToArrayBuffer");
async function firestoreFetch(env, path, options = {}) {
  const accessToken = await getGoogleAccessToken(env);
  const response = await fetch(`https://firestore.googleapis.com/v1/projects/${env.FIREBASE_PROJECT_ID}/databases/(default)/documents${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      ...options.headers || {}
    }
  });
  return response;
}
__name(firestoreFetch, "firestoreFetch");
async function getDocument(env, collectionName, id) {
  const response = await firestoreFetch(env, docPath(collectionName, id));
  if (response.status === 404)
    return null;
  if (!response.ok) {
    throw new Error(`Failed to read document ${collectionName}/${id}: ${response.status}`);
  }
  const data = await response.json();
  return {
    name: data.name,
    id: data.name?.split("/").pop(),
    updateTime: data.updateTime,
    createTime: data.createTime,
    data: firestoreObjectFromFields(data.fields || {})
  };
}
__name(getDocument, "getDocument");
async function writeDocument(env, collectionName, id, data, updateTime, options = {}) {
  const params = new URLSearchParams();
  if (updateTime)
    params.set("currentDocument.updateTime", updateTime);
  const updateMask = Array.isArray(options.updateMask) ? options.updateMask : null;
  if (updateMask) {
    for (const path of updateMask)
      params.append("updateMask.fieldPaths", path);
  }
  const queryString = params.toString();
  const url = queryString ? `${docPath(collectionName, id)}?${queryString}` : docPath(collectionName, id);
  const fields = updateMask ? Object.fromEntries(updateMask.filter((k) => data[k] !== void 0).map((k) => [k, firestoreValue(data[k])])) : firestoreFieldsFromObject(data);
  const response = await firestoreFetch(env, url, {
    method: "PATCH",
    body: JSON.stringify({ fields })
  });
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to write document ${collectionName}/${id}: ${response.status} ${errorText}`);
  }
  const body = await response.json();
  return {
    name: body.name,
    id: body.name?.split("/").pop(),
    updateTime: body.updateTime,
    data: firestoreObjectFromFields(body.fields || {})
  };
}
__name(writeDocument, "writeDocument");
async function deleteDocument(env, collectionName, id) {
  const response = await firestoreFetch(env, docPath(collectionName, id), {
    method: "DELETE"
  });
  if (!response.ok && response.status !== 404) {
    const errorText = await response.text();
    throw new Error(`Failed to delete document ${collectionName}/${id}: ${response.status} ${errorText}`);
  }
  return { ok: true };
}
__name(deleteDocument, "deleteDocument");
async function mergePlayerWithRetry(env, uid, mutate, { maxAttempts = 4 } = {}) {
  let lastError;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const fresh = await getDocument(env, "players", uid);
    const next = mutate(fresh?.data || {});
    try {
      return await writeDocument(env, "players", uid, next, fresh?.updateTime);
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError || new Error("Failed to update player profile after retries.");
}
__name(mergePlayerWithRetry, "mergePlayerWithRetry");
async function ensurePlayerDoc(env, authUser, { refreshDisplayName = false } = {}) {
  const written = await mergePlayerWithRetry(env, authUser.uid, (current) => {
    const seedName = clampDisplayName(refreshDisplayName ? authUser.name || current.displayName || "Player" : current.displayName || authUser.name || "Player");
    return {
      displayName: seedName || "Player",
      mu: Number.isFinite(Number(current.mu)) ? Math.min(MAX_MU2, Math.max(0, Number(current.mu))) : DEFAULT_MU,
      sigma: Number.isFinite(Number(current.sigma)) ? Math.min(DEFAULT_SIGMA2, Math.max(MIN_SIGMA, Number(current.sigma))) : DEFAULT_SIGMA2,
      rating: Number.isFinite(Number(current.rating)) ? Math.min(MAX_DISPLAY_RATING, Math.max(0, Number(current.rating))) : DEFAULT_DISPLAY_RATING,
      games: Number(current.games || 0),
      wins: Number(current.wins || 0),
      losses: Number(current.losses || 0),
      draws: Number(current.draws || 0),
      state: current.state || "idle",
      updatedAt: (/* @__PURE__ */ new Date()).toISOString()
    };
  });
  return written.data;
}
__name(ensurePlayerDoc, "ensurePlayerDoc");
async function setPlayerState(env, uid, newState) {
  return await mergePlayerWithRetry(env, uid, (current) => ({
    ...current,
    email: void 0,
    state: newState,
    updatedAt: (/* @__PURE__ */ new Date()).toISOString()
  }));
}
__name(setPlayerState, "setPlayerState");
async function verifyFirebaseIdToken(request, env) {
  const authorization = request.headers.get("Authorization") || "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  if (!token)
    throw new HttpError("Authentication required.", 401);
  let payload;
  try {
    ({ payload } = await jwtVerify(token, async (header) => {
      if (!header.kid)
        throw new Error("Firebase token missing key id.");
      const certs = await getFirebaseCerts();
      const pem = certs[header.kid];
      if (!pem)
        throw new Error("Firebase cert not found for token kid.");
      return importX509(pem, "RS256");
    }, {
      audience: env.FIREBASE_PROJECT_ID,
      issuer: `https://securetoken.google.com/${env.FIREBASE_PROJECT_ID}`
    }));
  } catch (_) {
    throw new HttpError("Authentication required.", 401);
  }
  if (payload.email_verified !== true) {
    throw new HttpError("Email must be verified.", 401);
  }
  if (!isAllowedEmail(payload.email || "")) {
    throw new HttpError("Only @gmail.com accounts can use this app.", 403);
  }
  return {
    uid: payload.user_id || payload.sub,
    email: payload.email || "",
    name: clampDisplayName(payload.name || payload.email || "")
  };
}
__name(verifyFirebaseIdToken, "verifyFirebaseIdToken");
async function getFirebaseCerts() {
  if (certCache && Date.now() < certCacheExpiresAt)
    return certCache;
  const response = await fetch(FIREBASE_CERTS_URL);
  if (!response.ok)
    throw new Error("Failed to fetch Firebase public certificates.");
  certCache = await response.json();
  certCacheExpiresAt = Date.now() + 60 * 60 * 1e3;
  return certCache;
}
__name(getFirebaseCerts, "getFirebaseCerts");
function getRequestJson(request) {
  return request.json().catch(() => ({}));
}
__name(getRequestJson, "getRequestJson");
async function queryQueueDocs(env, mode, extraFilters = {}) {
  const collectionId = matchmakingCollection(mode);
  const filters = [
    { fieldFilter: { field: { fieldPath: "mode" }, op: "EQUAL", value: { stringValue: mode } } },
    { fieldFilter: { field: { fieldPath: "status" }, op: "EQUAL", value: { stringValue: "searching" } } }
  ];
  if (Number.isFinite(Number(extraFilters.gridSize))) {
    filters.push({
      fieldFilter: {
        field: { fieldPath: "gridSize" },
        op: "EQUAL",
        value: { integerValue: String(Number(extraFilters.gridSize)) }
      }
    });
  }
  if (typeof extraFilters.timerEnabled === "boolean") {
    filters.push({
      fieldFilter: {
        field: { fieldPath: "timerEnabled" },
        op: "EQUAL",
        value: { booleanValue: extraFilters.timerEnabled }
      }
    });
  }
  const response = await firestoreFetch(env, ":runQuery", {
    method: "POST",
    body: JSON.stringify({
      structuredQuery: {
        from: [{ collectionId }],
        where: { compositeFilter: { op: "AND", filters } },
        limit: QUEUE_QUERY_LIMIT
      }
    })
  });
  if (!response.ok)
    throw new Error("Failed to query matchmaking queue.");
  const rows = await response.json();
  return rows.map((row) => row.document).filter(Boolean).map((doc) => ({
    id: doc.name?.split("/").pop(),
    updateTime: doc.updateTime,
    data: firestoreObjectFromFields(doc.fields || {})
  }));
}
__name(queryQueueDocs, "queryQueueDocs");
async function queryGamesByUidField(env, fieldPath, uid) {
  const response = await firestoreFetch(env, ":runQuery", {
    method: "POST",
    body: JSON.stringify({
      structuredQuery: {
        from: [{ collectionId: "games" }],
        where: {
          fieldFilter: { field: { fieldPath }, op: "EQUAL", value: { stringValue: uid } }
        },
        limit: ACTIVE_GAME_QUERY_LIMIT
      }
    })
  });
  if (!response.ok)
    return [];
  const rows = await response.json();
  return rows.map((row) => row.document).filter(Boolean).map((doc) => ({
    id: doc.name?.split("/").pop(),
    updateTime: doc.updateTime,
    data: firestoreObjectFromFields(doc.fields || {})
  }));
}
__name(queryGamesByUidField, "queryGamesByUidField");
async function findActiveGameForUser(env, uid) {
  const [asP1, asP2] = await Promise.all([
    queryGamesByUidField(env, "player1uid", uid),
    queryGamesByUidField(env, "player2uid", uid)
  ]);
  for (const game of [...asP1, ...asP2]) {
    if (game.data?.status === "active")
      return game;
  }
  return null;
}
__name(findActiveGameForUser, "findActiveGameForUser");
async function handleProfileEnsure(env, authUser) {
  const profile = await ensurePlayerDoc(env, authUser);
  return corsResponse({ ok: true, profile });
}
__name(handleProfileEnsure, "handleProfileEnsure");
async function handleProfileDelete(env, authUser) {
  try {
    await deleteDocument(env, "matchmakingQueue_ranked", authUser.uid);
  } catch (_) {
  }
  try {
    await deleteDocument(env, "matchmakingQueue_standard", authUser.uid);
  } catch (_) {
  }
  try {
    await deleteDocument(env, "players", authUser.uid);
  } catch (_) {
  }
  return corsResponse({ ok: true });
}
__name(handleProfileDelete, "handleProfileDelete");
async function handleProfileUpdateName(env, authUser, body) {
  const requested = clampDisplayName(body?.displayName || "");
  if (!requested) {
    return errorResponse("Display name is required.", 400);
  }
  const playerRef = await getDocument(env, "players", authUser.uid);
  if (!playerRef) {
    return errorResponse("Profile not found. Sign in again to initialise.", 404);
  }
  const next = {
    ...playerRef.data,
    displayName: requested,
    updatedAt: (/* @__PURE__ */ new Date()).toISOString()
  };
  await writeDocument(env, "players", authUser.uid, next);
  return corsResponse({ ok: true, displayName: requested });
}
__name(handleProfileUpdateName, "handleProfileUpdateName");
async function handleRoomAction(env, authUser, body) {
  const action = String(body.action || "");
  const displayName = clampDisplayName(authUser.name || "Player");
  if (action === "create") {
    const code = requireRoomCode(body.code);
    const gridSize = requireGridSize(body.gridSize);
    const gameId = `game_${code}`;
    await writeDocument(env, "games", gameId, {
      gameCode: code,
      mode: "standard",
      source: "room",
      status: "waiting",
      player1uid: authUser.uid,
      player1name: displayName,
      player2uid: null,
      player2name: null,
      gridSize,
      timerEnabled: !!body.timerEnabled,
      currentPlayer: 1,
      phase: "place",
      lastPlaces: null,
      gameStateJSON: null,
      placementHistory: { p1: [], p2: [] },
      timeouts: { p1: 0, p2: 0 },
      result: null,
      createdAt: (/* @__PURE__ */ new Date()).toISOString(),
      createdAtMs: Date.now()
    });
    return corsResponse({ ok: true, gameId });
  }
  if (action === "join") {
    const code = requireRoomCode(body.code);
    const gameId = `game_${code}`;
    const game = await getDocument(env, "games", gameId);
    if (!game)
      return errorResponse("Room not found.", 404);
    const current = game.data;
    if (current.status !== "waiting" || current.mode !== "standard" || current.source !== "room") {
      return errorResponse("Room is not available.", 412);
    }
    if (current.player1uid === authUser.uid || current.player2uid === authUser.uid) {
      return corsResponse({ ok: true, gameId });
    }
    if (current.player2uid)
      return errorResponse("Room is already full.", 412);
    await writeDocument(env, "games", gameId, {
      ...current,
      player2uid: authUser.uid,
      player2name: displayName,
      status: "active",
      turnDeadlineMs: current.timerEnabled ? Date.now() + TURN_DURATION_MS : null
    }, game.updateTime);
    return corsResponse({ ok: true, gameId });
  }
  if (action === "cancel") {
    const code = requireRoomCode(body.code);
    const gameId = `game_${code}`;
    const game = await getDocument(env, "games", gameId);
    if (!game)
      return corsResponse({ ok: true });
    const current = game.data;
    if (current.player1uid !== authUser.uid) {
      return errorResponse("Only the room owner can cancel it.", 403);
    }
    await writeDocument(env, "games", gameId, { ...current, status: "cancelled" }, game.updateTime);
    return corsResponse({ ok: true });
  }
  return errorResponse("Unknown room action.", 400);
}
__name(handleRoomAction, "handleRoomAction");
async function handleMatchmakingAction(env, authUser, body) {
  const action = String(body.action || "");
  const mode = normalizeMode(body.mode);
  const queueCollection = matchmakingCollection(mode);
  if (action === "enqueue") {
    const existingQueue = await getDocument(env, queueCollection, authUser.uid);
    if (existingQueue && existingQueue.data.status === "searching" && isFreshQueueEntry(existingQueue)) {
      return errorResponse("Already searching for a match", 400);
    }
    const activeGame = await findActiveGameForUser(env, authUser.uid);
    if (activeGame) {
      return corsResponse({
        error: "You are already in an active game.",
        activeGameId: activeGame.id
      }, 409);
    }
    const profile = await ensurePlayerDoc(env, authUser, { refreshDisplayName: true });
    let effectiveState = profile.state;
    if (effectiveState === "playing" || effectiveState === "searching") {
      try {
        await setPlayerState(env, authUser.uid, "idle");
      } catch (_) {
      }
      try {
        await deleteDocument(env, "matchmakingQueue_ranked", authUser.uid);
      } catch (_) {
      }
      try {
        await deleteDocument(env, "matchmakingQueue_standard", authUser.uid);
      } catch (_) {
      }
      effectiveState = "idle";
    }
    if (effectiveState !== "idle" && effectiveState !== "finished") {
      return errorResponse(`Cannot enqueue while in state: ${effectiveState}`, 400);
    }
    const queueGridSize = mode === "ranked" ? RANKED_GRID_SIZE : requireGridSize(body.gridSize);
    const queueData = {
      uid: authUser.uid,
      mode,
      status: "searching",
      displayName: clampDisplayName(authUser.name || "Player"),
      gridSize: queueGridSize,
      timerEnabled: mode === "ranked" ? true : !!body.timerEnabled,
      mu: profile.mu,
      sigma: profile.sigma,
      rating: profile.rating,
      gameId: null,
      matchedWith: null,
      queueToken: crypto.randomUUID(),
      joinedAtMs: Date.now(),
      updatedAtMs: Date.now(),
      updatedAt: (/* @__PURE__ */ new Date()).toISOString(),
      joinedAt: (/* @__PURE__ */ new Date()).toISOString()
    };
    await writeDocument(env, queueCollection, authUser.uid, queueData);
    await setPlayerState(env, authUser.uid, "searching");
    return corsResponse({ ok: true });
  }
  if (action === "cancel") {
    const profile = await getDocument(env, "players", authUser.uid);
    const currentState = profile?.data?.state;
    const queue = await getDocument(env, queueCollection, authUser.uid);
    if (queue) {
      await deleteDocument(env, queueCollection, authUser.uid);
    }
    if (currentState !== "playing") {
      await setPlayerState(env, authUser.uid, "idle");
    }
    return corsResponse({ ok: true });
  }
  if (action === "heartbeat") {
    const queue = await getDocument(env, queueCollection, authUser.uid);
    if (!queue)
      return corsResponse({ ok: true, alive: false });
    if (queue.data.status !== "searching") {
      return corsResponse({ ok: true, alive: false, status: queue.data.status, gameId: queue.data.gameId || null });
    }
    await writeDocument(env, queueCollection, authUser.uid, {
      ...queue.data,
      updatedAtMs: Date.now(),
      updatedAt: (/* @__PURE__ */ new Date()).toISOString()
    }, queue.updateTime);
    return corsResponse({ ok: true, alive: true });
  }
  if (action === "run") {
    const queue = await getDocument(env, queueCollection, authUser.uid);
    if (!queue)
      return corsResponse({ ok: true, gameId: null });
    const self = queue.data;
    if (self.status !== "searching")
      return corsResponse({ ok: true, gameId: null });
    const candidates = await queryQueueDocs(
      env,
      mode,
      mode === "standard" ? { gridSize: Number(self.gridSize) || 6, timerEnabled: !!self.timerEnabled } : {}
    );
    const others = candidates.filter((entry) => entry.id !== authUser.uid);
    if (!others.length)
      return corsResponse({ ok: true, gameId: null });
    const now = Date.now();
    const selfDisplayRating = Number(self.rating || DEFAULT_DISPLAY_RATING);
    const selfGridSize = Number(self.gridSize) || 6;
    const selfTimerEnabled = !!self.timerEnabled;
    const liveCandidates = [];
    for (const entry of others) {
      const entryUid = entry.data?.uid || entry.id;
      const entryIsBot = isBotUid(entryUid);
      if (!entryIsBot && !isFreshQueueEntry(entry)) {
        try {
          await deleteDocument(env, queueCollection, entry.id);
        } catch (_) {
        }
        continue;
      }
      if (entry.data?.status !== "searching")
        continue;
      if (!entryIsBot && (entry.data?.matchedWith || entry.data?.gameId))
        continue;
      if (mode === "standard") {
        const candGrid = Number(entry.data.gridSize) || 6;
        const candTimer = !!entry.data.timerEnabled;
        if (candGrid !== selfGridSize || candTimer !== selfTimerEnabled)
          continue;
      }
      liveCandidates.push(entry);
    }
    const N = liveCandidates.length;
    if (!N)
      return corsResponse({ ok: true, gameId: null });
    const poolSize = Math.min(
      Math.ceil(N / MATCHMAKING_POOL_DIVISOR) + 1,
      MATCHMAKING_POOL_MAX,
      N
    );
    const pool = liveCandidates.slice();
    for (let i = 0; i < poolSize; i++) {
      const j = i + Math.floor(Math.random() * (pool.length - i));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    pool.length = poolSize;
    let chosen = null;
    let bestDiff = Infinity;
    for (const entry of pool) {
      const rating = Number(entry.data.rating || DEFAULT_DISPLAY_RATING);
      const diff = Math.abs(rating - selfDisplayRating);
      if (diff < bestDiff) {
        bestDiff = diff;
        chosen = { candidate: entry, displayRating: rating };
      }
    }
    if (!chosen)
      return corsResponse({ ok: true, gameId: null });
    const candidateUid = chosen.candidate.data?.uid || chosen.candidate.id;
    const candidateIsBot = isBotUid(candidateUid);
    if (!candidateIsBot && authUser.uid >= candidateUid) {
      return corsResponse({ ok: true, gameId: null });
    }
    const candidateQueue = await getDocument(env, queueCollection, chosen.candidate.id);
    if (!candidateQueue)
      return corsResponse({ ok: true, gameId: null });
    const liveSelf = await getDocument(env, queueCollection, authUser.uid);
    if (!liveSelf || liveSelf.data.status !== "searching")
      return corsResponse({ ok: true, gameId: null });
    const selfProfileDoc = await getDocument(env, "players", authUser.uid);
    if (!selfProfileDoc || selfProfileDoc.data?.state !== "searching")
      return corsResponse({ ok: true, gameId: null });
    const liveCandidate = candidateQueue.data;
    const candidateProfileDoc = await getDocument(env, "players", candidateUid);
    if (!candidateProfileDoc)
      return corsResponse({ ok: true, gameId: null });
    if (!candidateIsBot && candidateProfileDoc.data?.state !== "searching") {
      return corsResponse({ ok: true, gameId: null });
    }
    if (liveCandidate.status !== "searching" || liveCandidate.mode !== mode) {
      return corsResponse({ ok: true, gameId: null });
    }
    if (!candidateIsBot && (liveCandidate.gameId || liveCandidate.matchedWith)) {
      return corsResponse({ ok: true, gameId: null });
    }
    if (mode === "standard") {
      const liveSelfGrid = Number(liveSelf.data.gridSize) || 6;
      const liveSelfTimer = !!liveSelf.data.timerEnabled;
      const liveCandGrid = Number(liveCandidate.gridSize) || 6;
      const liveCandTimer = !!liveCandidate.timerEnabled;
      if (liveCandGrid !== liveSelfGrid || liveCandTimer !== liveSelfTimer) {
        return corsResponse({ ok: true, gameId: null });
      }
    }
    const selfJoined = liveSelf.data.joinedAtMs || 0;
    const opponentJoined = liveCandidate.joinedAtMs || 0;
    const selfIsP1 = candidateIsBot ? true : selfJoined < opponentJoined || selfJoined === opponentJoined && authUser.uid < candidateUid;
    const p1 = selfIsP1 ? liveSelf.data : liveCandidate;
    const p2 = selfIsP1 ? liveCandidate : liveSelf.data;
    const gameId = `game_${crypto.randomUUID().replace(/-/g, "").slice(0, 16).toUpperCase()}`;
    const matchGridSize = mode === "ranked" ? RANKED_GRID_SIZE : parseGridSize(self.gridSize);
    await writeDocument(env, "games", gameId, {
      gameCode: null,
      mode,
      source: "matchmaking",
      status: "active",
      player1uid: selfIsP1 ? authUser.uid : candidateUid,
      player1name: clampDisplayName(buildPlayerName(p1)),
      player2uid: selfIsP1 ? candidateUid : authUser.uid,
      player2name: clampDisplayName(buildPlayerName(p2)),
      gridSize: matchGridSize,
      timerEnabled: mode === "ranked" ? true : !!self.timerEnabled,
      currentPlayer: 1,
      phase: "place",
      lastPlaces: null,
      gameStateJSON: null,
      placementHistory: { p1: [], p2: [] },
      timeouts: { p1: 0, p2: 0 },
      result: null,
      createdAt: (/* @__PURE__ */ new Date()).toISOString(),
      turnDeadlineMs: mode === "ranked" || !!self.timerEnabled ? Date.now() + TURN_DURATION_MS : null
    });
    if (liveSelf.data && liveSelf.data.gameId || !candidateIsBot && liveCandidate && liveCandidate.gameId) {
      try {
        await writeDocument(env, "games", gameId, { ...{ status: "cancelled", createdAt: (/* @__PURE__ */ new Date()).toISOString() } });
      } catch (e) {
      }
      return corsResponse({ ok: true, gameId: null });
    }
    try {
      await writeDocument(env, queueCollection, authUser.uid, {
        ...liveSelf.data,
        status: "matched",
        gameId,
        matchedWith: candidateUid,
        matchedAt: (/* @__PURE__ */ new Date()).toISOString(),
        updatedAtMs: Date.now(),
        updatedAt: (/* @__PURE__ */ new Date()).toISOString()
      }, liveSelf.updateTime);
      if (candidateIsBot) {
        await writeDocument(env, queueCollection, chosen.candidate.id, {
          ...liveCandidate,
          status: "searching",
          gameId: null,
          matchedWith: null,
          updatedAtMs: Date.now(),
          updatedAt: (/* @__PURE__ */ new Date()).toISOString()
        }, candidateQueue.updateTime);
      } else {
        await writeDocument(env, queueCollection, chosen.candidate.id, {
          ...liveCandidate,
          status: "matched",
          gameId,
          matchedWith: authUser.uid,
          matchedAt: (/* @__PURE__ */ new Date()).toISOString(),
          updatedAtMs: Date.now(),
          updatedAt: (/* @__PURE__ */ new Date()).toISOString()
        }, candidateQueue.updateTime);
      }
      await setPlayerState(env, authUser.uid, "playing");
      if (!candidateIsBot) {
        await setPlayerState(env, candidateUid, "playing");
      }
      if (candidateIsBot) {
        try {
          const tier = tierFromBotUid(candidateUid);
          const botPlayerNumber = selfIsP1 ? 2 : 1;
          const id = env.MATCH_BOT.idFromName(gameId);
          const stub = env.MATCH_BOT.get(id);
          await stub.fetch("https://match-bot.internal/start", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ gameId, botUid: candidateUid, tier, botPlayerNumber })
          });
        } catch (botErr) {
          console.warn("MatchBot kickoff failed", gameId, botErr?.message);
        }
      }
      return corsResponse({ ok: true, gameId });
    } catch (err) {
      try {
        await writeDocument(env, "games", gameId, { ...{ status: "cancelled", cancelledReason: "queue_update_failed", cancelledAt: (/* @__PURE__ */ new Date()).toISOString() } });
      } catch (e) {
      }
      return corsResponse({ ok: true, gameId: null });
    }
  }
  return errorResponse("Unknown matchmaking action.", 400);
}
__name(handleMatchmakingAction, "handleMatchmakingAction");
async function finalizeMatchCleanup(env, game) {
  if (!game)
    return;
  const mode = normalizeMode(game.mode);
  const queueCollection = matchmakingCollection(mode);
  const uids = [game.player1uid, game.player2uid].filter(Boolean);
  await Promise.all(uids.map(async (uid) => {
    if (isBotUid(uid))
      return;
    try {
      await deleteDocument(env, queueCollection, uid);
    } catch (_) {
    }
    try {
      await setPlayerState(env, uid, "idle");
    } catch (_) {
    }
  }));
}
__name(finalizeMatchCleanup, "finalizeMatchCleanup");
async function applyTurnTimeout(env, gameDoc, gameId, { maxAttempts = 3 } = {}) {
  const initialTarget = gameDoc.data.currentPlayer;
  const initialPhase = gameDoc.data.phase;
  const initialHistoryLen = ((gameDoc.data.placementHistory || {})[`p${initialTarget}`] || []).length;
  let lastError;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (attempt > 0) {
      gameDoc = await getDocument(env, "games", gameId);
      if (!gameDoc)
        return { applied: false, reason: "gone" };
      const fresh = gameDoc.data;
      if (fresh.status !== "active")
        return { applied: false, reason: "not_active" };
      if (fresh.currentPlayer !== initialTarget || fresh.phase !== initialPhase) {
        return { applied: false, reason: "player_moved" };
      }
      const freshLen = ((fresh.placementHistory || {})[`p${initialTarget}`] || []).length;
      if (freshLen !== initialHistoryLen) {
        return { applied: false, reason: "player_moved" };
      }
    }
    const current = gameDoc.data;
    if (current.status !== "active")
      return { applied: false, reason: "not_active" };
    const targetPlayerNumber = current.currentPlayer;
    if (targetPlayerNumber !== 1 && targetPlayerNumber !== 2) {
      return { applied: false, reason: "invalid_current_player" };
    }
    const size2 = parseGridSize(current.gridSize);
    const state = normalizeGameState(current.gameStateJSON, size2);
    const timeouts = current.timeouts || { p1: 0, p2: 0 };
    const myKey = `p${targetPlayerNumber}`;
    const newCount = (timeouts[myKey] || 0) + 1;
    let revertedState = state;
    let revertedHistory = current.placementHistory || { p1: [], p2: [] };
    if (current.phase === "eliminate" && current.lastPlaces) {
      revertedState = deepCopyState(state);
      const r = current.lastPlaces.row;
      const c = current.lastPlaces.col;
      if (revertedState[r] && revertedState[r][c]) {
        revertedState[r][c].player = null;
      }
      const myHist = historyToArray(revertedHistory[myKey] || []);
      myHist.pop();
      revertedHistory = {
        p1: historyToArray(revertedHistory.p1 || []),
        p2: historyToArray(revertedHistory.p2 || []),
        [myKey]: myHist
      };
    }
    try {
      if (newCount >= 3) {
        const s1 = getBiggestGroup(revertedState, size2, 1);
        const s2 = getBiggestGroup(revertedState, size2, 2);
        const winner = targetPlayerNumber === 1 ? 2 : 1;
        const finishedGame = {
          ...current,
          status: "finished",
          gameStateJSON: JSON.stringify(revertedState),
          placementHistory: revertedHistory,
          lastPlaces: null,
          result: { winner, score1: s1, score2: s2, timeout: true, loser: targetPlayerNumber },
          timeouts: { ...timeouts, [myKey]: newCount },
          turnDeadlineMs: null
        };
        await writeDocument(env, "games", gameId, finishedGame, gameDoc.updateTime);
        await finalizeMatchCleanup(env, finishedGame);
        return { applied: true, finished: true };
      }
      const nextDeadline = current.timerEnabled ? Date.now() + TURN_DURATION_MS : null;
      await writeDocument(env, "games", gameId, {
        ...current,
        currentPlayer: targetPlayerNumber === 1 ? 2 : 1,
        phase: "place",
        lastPlaces: null,
        gameStateJSON: JSON.stringify(revertedState),
        placementHistory: revertedHistory,
        timeouts: { ...timeouts, [myKey]: newCount },
        turnDeadlineMs: nextDeadline
      }, gameDoc.updateTime);
      return { applied: true, finished: false };
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError || new Error("applyTurnTimeout: precondition failed after retries");
}
__name(applyTurnTimeout, "applyTurnTimeout");
async function applyRankedForfeit(env, gameDoc, gameId, forfeitingUid) {
  const current = gameDoc.data;
  if (current.status !== "active" || current.mode !== "ranked")
    return null;
  const forfeiterIsP1 = forfeitingUid === current.player1uid;
  const forfeiterNumber = forfeiterIsP1 ? 1 : 2;
  const opponentNumber = forfeiterIsP1 ? 2 : 1;
  const [p1Doc, p2Doc] = await Promise.all([
    getDocument(env, "players", current.player1uid),
    getDocument(env, "players", current.player2uid)
  ]);
  const p1Raw = p1Doc?.data || {};
  const p2Raw = p2Doc?.data || {};
  const p1 = normalizeSkillProfile(p1Raw);
  const p2 = normalizeSkillProfile(p2Raw);
  const scoreP1 = forfeiterIsP1 ? 0 : 1;
  const { delta1, delta2, newR1, newR2, profile1, profile2 } = computeSkillDelta(p1, p2, scoreP1);
  const size2 = parseGridSize(current.gridSize);
  const state = normalizeGameState(current.gameStateJSON, size2);
  const score1 = getBiggestGroup(state, size2, 1);
  const score2 = getBiggestGroup(state, size2, 2);
  const finishedGame = {
    ...current,
    status: "finished",
    leftBy: forfeitingUid,
    turnDeadlineMs: null,
    result: {
      winner: opponentNumber,
      score1,
      score2,
      forfeit: true,
      loser: forfeiterNumber,
      delta1,
      delta2,
      newR1,
      newR2
    }
  };
  await writeDocument(env, "games", gameId, finishedGame, gameDoc.updateTime);
  await mergePlayerWithRetry(env, current.player1uid, (raw) => ({
    ...raw,
    email: void 0,
    displayName: clampDisplayName(raw.displayName || current.player1name || "Player"),
    mu: profile1.mu,
    sigma: profile1.sigma,
    rating: newR1,
    games: Number(raw.games || 0) + 1,
    wins: scoreP1 === 1 ? Number(raw.wins || 0) + 1 : Number(raw.wins || 0),
    losses: scoreP1 === 0 ? Number(raw.losses || 0) + 1 : Number(raw.losses || 0),
    draws: Number(raw.draws || 0),
    updatedAt: (/* @__PURE__ */ new Date()).toISOString()
  }));
  await mergePlayerWithRetry(env, current.player2uid, (raw) => ({
    ...raw,
    email: void 0,
    displayName: clampDisplayName(raw.displayName || current.player2name || "Player"),
    mu: profile2.mu,
    sigma: profile2.sigma,
    rating: newR2,
    games: Number(raw.games || 0) + 1,
    wins: scoreP1 === 0 ? Number(raw.wins || 0) + 1 : Number(raw.wins || 0),
    losses: scoreP1 === 1 ? Number(raw.losses || 0) + 1 : Number(raw.losses || 0),
    draws: Number(raw.draws || 0),
    updatedAt: (/* @__PURE__ */ new Date()).toISOString()
  }));
  await finalizeMatchCleanup(env, finishedGame);
  return finishedGame;
}
__name(applyRankedForfeit, "applyRankedForfeit");
async function handleGameValidate(env, authUser, body) {
  const gameId = requireGameId(body.gameId);
  const game = await getDocument(env, "games", gameId);
  if (!game)
    return corsResponse({ ok: true, valid: false });
  const current = game.data;
  const isParticipant = current.player1uid === authUser.uid || current.player2uid === authUser.uid;
  const active = current.status === "active";
  return corsResponse({ ok: true, valid: Boolean(isParticipant && active) });
}
__name(handleGameValidate, "handleGameValidate");
async function applyMoveInternal(env, callerUid, gameId, rawRow, rawCol) {
  const game = await getDocument(env, "games", gameId);
  if (!game)
    throw new HttpError("Game not found.", 404);
  const current = game.data;
  if (current.status !== "active")
    throw new HttpError("Game is not active.", 412);
  if (current.player1uid !== callerUid && current.player2uid !== callerUid) {
    throw new HttpError("Only participants can play.", 403);
  }
  const playerNumber = current.player1uid === callerUid ? 1 : 2;
  if (current.currentPlayer !== playerNumber)
    throw new HttpError("Not your turn.", 412);
  if (current.timerEnabled) {
    const deadline2 = Number(current.turnDeadlineMs);
    if (Number.isFinite(deadline2) && deadline2 > 0 && Date.now() > deadline2 + TURN_DEADLINE_GRACE_MS) {
      throw new HttpError("Turn has timed out.", 412);
    }
  }
  const size2 = parseGridSize(current.gridSize);
  const row = requireBoardIndex(rawRow, size2, "row");
  const col = requireBoardIndex(rawCol, size2, "col");
  const state = normalizeGameState(current.gameStateJSON, size2);
  const history2 = current.placementHistory || { p1: [], p2: [] };
  if (current.phase === "place") {
    if (!isValidPlacement(state, size2, row, col)) {
      throw new HttpError("Invalid placement.", 400);
    }
    const nextState = applyPlace2(state, playerNumber, row, col);
    const nextHistory = {
      p1: historyToArray(history2.p1),
      p2: historyToArray(history2.p2)
    };
    nextHistory[`p${playerNumber}`].push({ r: row, c: col });
    try {
      await writeDocument(env, "games", gameId, {
        ...current,
        phase: "eliminate",
        lastPlaces: { row, col },
        gameStateJSON: JSON.stringify(nextState),
        placementHistory: nextHistory,
        timeouts: { ...current.timeouts || { p1: 0, p2: 0 }, [`p${playerNumber}`]: 0 }
      }, game.updateTime);
    } catch (_) {
      throw new HttpError("Game state changed. Please retry.", 409);
    }
    return { ok: true };
  }
  if (current.phase === "eliminate") {
    if (!isValidElimination(state, current.lastPlaces, row, col)) {
      throw new HttpError("Invalid elimination.", 400);
    }
    const nextState = applyEliminate2(state, row, col);
    const nextHistory = {
      p1: historyToArray(history2.p1),
      p2: historyToArray(history2.p2)
    };
    const result = computeGameResult(nextState, size2);
    const update = {
      ...current,
      gameStateJSON: JSON.stringify(nextState),
      placementHistory: nextHistory,
      lastPlaces: null
    };
    if (result) {
      update.status = "finished";
      update.result = result;
      update.turnDeadlineMs = null;
    } else {
      update.currentPlayer = playerNumber === 1 ? 2 : 1;
      update.phase = "place";
      update.turnDeadlineMs = current.timerEnabled ? Date.now() + TURN_DURATION_MS : null;
    }
    try {
      await writeDocument(env, "games", gameId, update, game.updateTime);
    } catch (_) {
      throw new HttpError("Game state changed. Please retry.", 409);
    }
    if (result)
      await finalizeMatchCleanup(env, update);
    return { ok: true };
  }
  throw new HttpError("Invalid game phase.", 412);
}
__name(applyMoveInternal, "applyMoveInternal");
async function handleGameAction(env, authUser, body) {
  const action = String(body.action || "");
  const gameId = requireGameId(body.gameId);
  if (action === "join") {
    const game = await getDocument(env, "games", gameId);
    if (!game)
      return errorResponse("Game not found.", 404);
    const current = game.data;
    if (current.status !== "active")
      return errorResponse("Game is not active.", 412);
    if (current.player1uid !== authUser.uid && current.player2uid !== authUser.uid) {
      return errorResponse("Only participants can join.", 403);
    }
    await setPlayerState(env, authUser.uid, "playing");
    return corsResponse({ ok: true });
  }
  if (action === "move") {
    try {
      await applyMoveInternal(env, authUser.uid, gameId, body.row, body.col);
      return corsResponse({ ok: true });
    } catch (err) {
      if (err instanceof HttpError)
        return errorResponse(err.message, err.status);
      throw err;
    }
  }
  if (action === "timeout") {
    const game = await getDocument(env, "games", gameId);
    if (!game)
      return errorResponse("Game not found.", 404);
    const current = game.data;
    if (current.status !== "active")
      return errorResponse("Game is not active.", 412);
    if (current.player1uid !== authUser.uid && current.player2uid !== authUser.uid) {
      return errorResponse("Only participants can time out.", 403);
    }
    const playerNumber = current.player1uid === authUser.uid ? 1 : 2;
    if (current.currentPlayer !== playerNumber)
      return errorResponse("Not your turn.", 412);
    if (!current.timerEnabled) {
      return errorResponse("Timer is not enabled for this game.", 412);
    }
    const deadline2 = Number(current.turnDeadlineMs);
    if (!Number.isFinite(deadline2) || deadline2 <= 0) {
      return errorResponse("No turn deadline set.", 412);
    }
    if (Date.now() < deadline2) {
      return errorResponse("Turn has not timed out yet.", 412);
    }
    try {
      await applyTurnTimeout(env, game, gameId);
    } catch (_) {
      return errorResponse("Game state changed. Please retry.", 409);
    }
    return corsResponse({ ok: true });
  }
  if (action === "claim-timeout") {
    const game = await getDocument(env, "games", gameId);
    if (!game)
      return errorResponse("Game not found.", 404);
    const current = game.data;
    if (current.status !== "active")
      return errorResponse("Game is not active.", 412);
    if (current.player1uid !== authUser.uid && current.player2uid !== authUser.uid) {
      return errorResponse("Only participants can claim timeout.", 403);
    }
    const callerNumber = current.player1uid === authUser.uid ? 1 : 2;
    if (current.currentPlayer === callerNumber) {
      return errorResponse("Cannot claim timeout on your own turn.", 412);
    }
    if (!current.timerEnabled) {
      return errorResponse("Timer is not enabled for this game.", 412);
    }
    const deadline2 = Number(current.turnDeadlineMs);
    if (!Number.isFinite(deadline2) || deadline2 <= 0) {
      return errorResponse("No turn deadline set.", 412);
    }
    if (Date.now() < deadline2) {
      return errorResponse("Turn has not timed out yet.", 412);
    }
    try {
      await applyTurnTimeout(env, game, gameId);
    } catch (_) {
      return errorResponse("Game state changed. Please retry.", 409);
    }
    return corsResponse({ ok: true });
  }
  if (action === "leave") {
    const game = await getDocument(env, "games", gameId);
    if (!game)
      return corsResponse({ ok: true });
    const current = game.data;
    if (current.status !== "active")
      return corsResponse({ ok: true });
    if (current.player1uid !== authUser.uid && current.player2uid !== authUser.uid) {
      return errorResponse("Only participants can leave.", 403);
    }
    if (current.mode === "ranked") {
      try {
        await applyRankedForfeit(env, game, gameId, authUser.uid);
      } catch (_) {
        const refreshed = await getDocument(env, "games", gameId);
        if (refreshed?.data?.status === "active") {
          await applyRankedForfeit(env, refreshed, gameId, authUser.uid);
        }
      }
      return corsResponse({ ok: true });
    }
    const leftGame = {
      ...current,
      status: "left",
      leftBy: authUser.uid
    };
    await writeDocument(env, "games", gameId, leftGame, game.updateTime);
    await finalizeMatchCleanup(env, leftGame);
    return corsResponse({ ok: true });
  }
  if (action === "heartbeat") {
    const game = await getDocument(env, "games", gameId);
    if (!game)
      return corsResponse({ ok: true });
    const current = game.data;
    if (current.status !== "active")
      return corsResponse({ ok: true });
    if (current.player1uid !== authUser.uid && current.player2uid !== authUser.uid) {
      return errorResponse("Only participants can heartbeat.", 403);
    }
    const playerNumber = current.player1uid === authUser.uid ? 1 : 2;
    const fieldPath = `lastSeenP${playerNumber}Ms`;
    try {
      await writeDocument(
        env,
        "games",
        gameId,
        { [fieldPath]: Date.now() },
        null,
        { updateMask: [fieldPath] }
      );
    } catch (_) {
    }
    return corsResponse({ ok: true });
  }
  return errorResponse("Unknown game action.", 400);
}
__name(handleGameAction, "handleGameAction");
async function handleRankedFinalize(env, authUser, body) {
  const gameId = requireGameId(body.gameId);
  const game = await getDocument(env, "games", gameId);
  if (!game)
    return errorResponse("Game not found.", 404);
  const current = game.data;
  if (current.player1uid !== authUser.uid && current.player2uid !== authUser.uid) {
    return errorResponse("Only participants can finalize game result.", 403);
  }
  if (current.mode !== "ranked")
    return errorResponse("Only ranked games are finalized here.", 412);
  if (current.status !== "finished" || !current.result)
    return errorResponse("Game is not finished.", 412);
  if (current.result.delta1 != null && current.result.delta2 != null) {
    return corsResponse({ ok: true, result: current.result });
  }
  const [p1Doc, p2Doc] = await Promise.all([
    getDocument(env, "players", current.player1uid),
    getDocument(env, "players", current.player2uid)
  ]);
  const p1 = normalizeSkillProfile(p1Doc?.data || {});
  const p2 = normalizeSkillProfile(p2Doc?.data || {});
  const scoreP1 = current.result.winner === 1 ? 1 : current.result.winner === 2 ? 0 : 0.5;
  const { delta1, delta2, newR1, newR2, profile1, profile2 } = computeSkillDelta(p1, p2, scoreP1);
  const result = { ...current.result, delta1, delta2, newR1, newR2 };
  try {
    await writeDocument(env, "games", gameId, { ...current, result }, game.updateTime);
  } catch (_) {
    const refreshed = await getDocument(env, "games", gameId);
    const refreshedResult = refreshed?.data?.result;
    if (refreshedResult?.delta1 != null && refreshedResult?.delta2 != null) {
      return corsResponse({ ok: true, result: refreshedResult });
    }
    return errorResponse("Game state changed. Please retry.", 409);
  }
  await mergePlayerWithRetry(env, current.player1uid, (raw) => ({
    ...raw,
    email: void 0,
    displayName: clampDisplayName(raw.displayName || current.player1name || "Player"),
    mu: profile1.mu,
    sigma: profile1.sigma,
    rating: newR1,
    games: Number(raw.games || 0) + 1,
    wins: scoreP1 === 1 ? Number(raw.wins || 0) + 1 : Number(raw.wins || 0),
    losses: scoreP1 === 0 ? Number(raw.losses || 0) + 1 : Number(raw.losses || 0),
    draws: scoreP1 === 0.5 ? Number(raw.draws || 0) + 1 : Number(raw.draws || 0),
    updatedAt: (/* @__PURE__ */ new Date()).toISOString()
  }));
  await mergePlayerWithRetry(env, current.player2uid, (raw) => ({
    ...raw,
    email: void 0,
    displayName: clampDisplayName(raw.displayName || current.player2name || "Player"),
    mu: profile2.mu,
    sigma: profile2.sigma,
    rating: newR2,
    games: Number(raw.games || 0) + 1,
    wins: scoreP1 === 0 ? Number(raw.wins || 0) + 1 : Number(raw.wins || 0),
    losses: scoreP1 === 1 ? Number(raw.losses || 0) + 1 : Number(raw.losses || 0),
    draws: scoreP1 === 0.5 ? Number(raw.draws || 0) + 1 : Number(raw.draws || 0),
    updatedAt: (/* @__PURE__ */ new Date()).toISOString()
  }));
  await setPlayerState(env, current.player1uid, "idle");
  await setPlayerState(env, current.player2uid, "idle");
  return corsResponse({ ok: true, result });
}
__name(handleRankedFinalize, "handleRankedFinalize");
function pickAllowedOrigin(origin) {
  if (!origin)
    return null;
  try {
    const u = new URL(origin);
    return ALLOWED_ORIGIN_HOSTS.has(u.hostname) ? origin : null;
  } catch (_) {
    return null;
  }
}
__name(pickAllowedOrigin, "pickAllowedOrigin");
async function checkRateLimit(env, key) {
  const limiter = env?.RATE_LIMITER;
  if (!limiter || typeof limiter.limit !== "function")
    return true;
  try {
    const { success } = await limiter.limit({ key });
    return !!success;
  } catch (_) {
    return true;
  }
}
__name(checkRateLimit, "checkRateLimit");
async function handleRequest(request, env) {
  if (request.method === "OPTIONS")
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  if (request.method !== "POST")
    return errorResponse("Method not allowed.", 405);
  const url = new URL(request.url);
  const authUser = await verifyFirebaseIdToken(request, env);
  const body = await getRequestJson(request);
  if (!await checkRateLimit(env, `${authUser.uid}:${url.pathname}`)) {
    return errorResponse("Too many requests. Please slow down.", 429);
  }
  if (url.pathname === "/profile/update-name") {
    return handleProfileUpdateName(env, authUser, body);
  }
  if (url.pathname === "/profile/delete") {
    return handleProfileDelete(env, authUser);
  }
  if (url.pathname === "/profile/ensure") {
    return handleProfileEnsure(env, authUser);
  }
  if (url.pathname === "/game/validate") {
    return handleGameValidate(env, authUser, body);
  }
  if (url.pathname === "/profile/state") {
    const player = await getDocument(env, "players", authUser.uid);
    const state = player?.data?.state || "idle";
    return corsResponse({ state, playerExists: !!player });
  }
  if (url.pathname === "/room/create" || url.pathname === "/room/join" || url.pathname === "/room/cancel") {
    const action = url.pathname.split("/").pop();
    return handleRoomAction(env, authUser, { ...body, action });
  }
  if (url.pathname === "/matchmaking/enqueue" || url.pathname === "/matchmaking/run" || url.pathname === "/matchmaking/cancel" || url.pathname === "/matchmaking/heartbeat") {
    const action = url.pathname.split("/").pop();
    return handleMatchmakingAction(env, authUser, { ...body, action });
  }
  if (url.pathname === "/game/move" || url.pathname === "/game/timeout" || url.pathname === "/game/claim-timeout" || url.pathname === "/game/leave" || url.pathname === "/game/join" || url.pathname === "/game/heartbeat") {
    const action = url.pathname.split("/").pop();
    return handleGameAction(env, authUser, { ...body, action });
  }
  if (url.pathname === "/ranked/finalize") {
    return handleRankedFinalize(env, authUser, body);
  }
  return errorResponse("Not found.", 404);
}
__name(handleRequest, "handleRequest");
async function sweepStaleGames(env) {
  let response;
  try {
    response = await firestoreFetch(env, ":runQuery", {
      method: "POST",
      body: JSON.stringify({
        structuredQuery: {
          from: [{ collectionId: "games" }],
          where: {
            fieldFilter: { field: { fieldPath: "status" }, op: "EQUAL", value: { stringValue: "active" } }
          },
          limit: 500
        }
      })
    });
  } catch (_) {
    return;
  }
  if (!response.ok)
    return;
  const rows = await response.json();
  const games = rows.map((row) => row.document).filter(Boolean).map((doc) => ({
    id: doc.name?.split("/").pop(),
    updateTime: doc.updateTime,
    data: firestoreObjectFromFields(doc.fields || {})
  }));
  const now = Date.now();
  for (const game of games) {
    const data = game.data || {};
    const isRanked = data.mode === "ranked";
    const deadline2 = Number(data.turnDeadlineMs);
    if (data.timerEnabled && Number.isFinite(deadline2) && deadline2 > 0 && now > deadline2 + TURN_DEADLINE_GRACE_MS) {
      try {
        await applyTurnTimeout(env, game, game.id);
      } catch (_) {
      }
      continue;
    }
    const cutoff = now - (isRanked ? STALE_GAME_THRESHOLD_MS : STALE_STANDARD_GAME_THRESHOLD_MS);
    const createdFloor = Number(data.createdAtMs) || Date.parse(data.createdAt || "") || now;
    const lastP1 = Number(data.lastSeenP1Ms) || createdFloor;
    const lastP2 = Number(data.lastSeenP2Ms) || createdFloor;
    let p1Stale = lastP1 < cutoff;
    let p2Stale = lastP2 < cutoff;
    if (p1Stale && isBotUid(data.player1uid))
      p1Stale = false;
    if (p2Stale && isBotUid(data.player2uid))
      p2Stale = false;
    if (!p1Stale && !p2Stale)
      continue;
    try {
      if (!isRanked || p1Stale && p2Stale) {
        const cancelledGame = {
          ...data,
          status: "cancelled",
          cancelledReason: isRanked ? "both_abandoned" : "standard_abandoned",
          cancelledAt: (/* @__PURE__ */ new Date()).toISOString()
        };
        await writeDocument(env, "games", game.id, cancelledGame, game.updateTime);
        await finalizeMatchCleanup(env, cancelledGame);
      } else {
        const staleUid = p1Stale ? data.player1uid : data.player2uid;
        if (staleUid) {
          await applyRankedForfeit(env, game, game.id, staleUid);
        }
      }
    } catch (_) {
    }
  }
}
__name(sweepStaleGames, "sweepStaleGames");
async function purgeOldGames(env) {
  const PURGE_AGE_MS = 7 * 24 * 60 * 60 * 1e3;
  const PAGE_SIZE = 300;
  const MAX_PAGES = 20;
  const cutoff = Date.now() - PURGE_AGE_MS;
  let totalDeleted = 0;
  for (let page = 0; page < MAX_PAGES; page++) {
    let response;
    try {
      response = await firestoreFetch(env, ":runQuery", {
        method: "POST",
        body: JSON.stringify({
          structuredQuery: {
            from: [{ collectionId: "games" }],
            where: {
              fieldFilter: {
                field: { fieldPath: "createdAtMs" },
                op: "LESS_THAN",
                value: { integerValue: String(cutoff) }
              }
            },
            limit: PAGE_SIZE
          }
        })
      });
    } catch (err) {
      console.error("[purgeOldGames] runQuery threw", err?.message);
      break;
    }
    if (!response.ok) {
      const txt = await response.text();
      console.error(`[purgeOldGames] runQuery ${response.status}: ${txt}`);
      break;
    }
    const rows = await response.json();
    const docs = rows.map((r) => r.document).filter(Boolean);
    if (docs.length === 0)
      break;
    const writes = docs.map((d) => ({ delete: d.name }));
    try {
      const commit = await firestoreFetch(env, ":commit", {
        method: "POST",
        body: JSON.stringify({ writes })
      });
      if (!commit.ok) {
        const txt = await commit.text();
        console.error(`[purgeOldGames] commit ${commit.status}: ${txt}`);
        break;
      }
      totalDeleted += writes.length;
    } catch (err) {
      console.error("[purgeOldGames] commit threw", err?.message);
      break;
    }
    if (docs.length < PAGE_SIZE)
      break;
  }
  console.log(`[purgeOldGames] done \u2014 deleted ${totalDeleted} games older than 7 days (cutoff=${cutoff})`);
}
__name(purgeOldGames, "purgeOldGames");
function applyCorsOrigin(response, allowOrigin) {
  const headers = new Headers(response.headers);
  if (allowOrigin) {
    headers.set("Access-Control-Allow-Origin", allowOrigin);
    const existingVary = headers.get("Vary");
    headers.set("Vary", existingVary ? `${existingVary}, Origin` : "Origin");
  } else {
    headers.delete("Access-Control-Allow-Origin");
  }
  return new Response(response.body, { status: response.status, headers });
}
__name(applyCorsOrigin, "applyCorsOrigin");
var MatchBot = class {
  constructor(state, env) {
    this.state = state;
    this.env = env;
  }
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === "/start" && request.method === "POST") {
      let cfg;
      try {
        cfg = await request.json();
      } catch (_) {
        return new Response("bad json", { status: 400 });
      }
      if (!cfg || typeof cfg.gameId !== "string")
        return new Response("bad cfg", { status: 400 });
      const expectedName = this.state.id.name;
      if (expectedName && expectedName !== cfg.gameId) {
        return new Response("cfg/gameId mismatch", { status: 400 });
      }
      await this.state.storage.put("cfg", cfg);
      await this.state.storage.setAlarm(Date.now() + 500);
      return new Response("ok");
    }
    return new Response("not found", { status: 404 });
  }
  async alarm() {
    const alarmStart = Date.now();
    const cfg = await this.state.storage.get("cfg");
    if (!cfg) {
      console.log("[MatchBot] alarm fired with no cfg \u2014 DO already cleaned");
      return;
    }
    const tag2 = `[MatchBot:${cfg.gameId.slice(-6)}:${cfg.tier}]`;
    let game;
    const readStart = Date.now();
    try {
      game = await getDocument(this.env, "games", cfg.gameId);
    } catch (err) {
      console.warn(`${tag2} firestore read FAILED`, err?.message);
      await this.state.storage.setAlarm(Date.now() + 1500);
      return;
    }
    const readMs = Date.now() - readStart;
    if (!game || game.data?.status !== "active") {
      console.log(`${tag2} game ended (${game?.data?.status || "missing"}) \u2014 DO cleanup`);
      await this.state.storage.deleteAll();
      return;
    }
    if (game.data.currentPlayer !== cfg.botPlayerNumber) {
      console.log(`${tag2} not my turn (current=${game.data.currentPlayer}, me=${cfg.botPlayerNumber}) \u2014 re-poll in 1500ms (read ${readMs}ms)`);
      await this.state.storage.setAlarm(Date.now() + 1500);
      return;
    }
    console.log(`${tag2} MY TURN phase=${game.data.phase} \u2014 starting search (read ${readMs}ms)`);
    const size2 = parseGridSize(game.data.gridSize);
    const state = normalizeGameState(game.data.gameStateJSON, size2);
    const searchStart = Date.now();
    let move = null;
    let searchError = null;
    try {
      move = await chooseAIMove({
        tier: cfg.tier,
        state,
        size: size2,
        phase: game.data.phase,
        lastPlaces: game.data.lastPlaces,
        currentPlayer: cfg.botPlayerNumber
      });
    } catch (err) {
      searchError = err;
    }
    const searchMs = Date.now() - searchStart;
    if (searchError) {
      console.error(`${tag2} chooseBotMove THREW after ${searchMs}ms:`, searchError?.message, searchError?.stack);
    } else if (!move) {
      console.warn(`${tag2} chooseBotMove returned NULL after ${searchMs}ms (phase=${game.data.phase}, gridSize=${size2})`);
    } else {
      console.log(`${tag2} chooseBotMove \u2192 ${move.row},${move.col} after ${searchMs}ms`);
    }
    if (move) {
      const applyStart = Date.now();
      try {
        await applyMoveInternal(this.env, cfg.botUid, cfg.gameId, move.row, move.col);
        console.log(`${tag2} move APPLIED in ${Date.now() - applyStart}ms (total alarm ${Date.now() - alarmStart}ms)`);
      } catch (err) {
        console.warn(`${tag2} applyMoveInternal REJECTED:`, err?.message);
      }
    } else {
      console.warn(`${tag2} skipping apply \u2014 no move (alarm total ${Date.now() - alarmStart}ms)`);
    }
    await this.state.storage.setAlarm(Date.now() + 800);
  }
};
__name(MatchBot, "MatchBot");
var src_default = {
  async fetch(request, env) {
    const allowOrigin = pickAllowedOrigin(request.headers.get("Origin"));
    let response;
    try {
      response = await handleRequest(request, env);
    } catch (error) {
      if (error instanceof HttpError) {
        response = errorResponse(error.message, error.status);
      } else {
        console.error("worker: unhandled error", error);
        response = errorResponse("Internal server error.", 500);
      }
    }
    return applyCorsOrigin(response, allowOrigin);
  },
  async scheduled(event, env, ctx) {
    if (event.cron === "0 0 * * SAT") {
      ctx.waitUntil(purgeOldGames(env));
      return;
    }
    ctx.waitUntil(sweepStaleGames(env));
    ctx.waitUntil(seedBots(env, { getDocument, writeDocument }));
  }
};
export {
  MatchBot,
  applyMoveInternal,
  src_default as default
};
//# sourceMappingURL=index.js.map
