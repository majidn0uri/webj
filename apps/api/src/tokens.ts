/** نمادهای تزریقِ وابستگی — استفاده از نماد به‌جای کلاس، ما را از وابستگی به ابرداده‌ی دکوراتورها بی‌نیاز می‌کند */
export const CONFIG = Symbol('CONFIG');
export const DB = Symbol('DB');
export const TOKEN_SERVICE = Symbol('TOKEN_SERVICE');
export const AUTH_SERVICE = Symbol('AUTH_SERVICE');
export const ACCESS_CONTROL = Symbol('ACCESS_CONTROL');
export const OUTBOX_WORKER = Symbol('OUTBOX_WORKER');
export const RATE_LIMITER = Symbol('RATE_LIMITER');
export const METRICS = Symbol('METRICS');
export const REQUEST_LOGGER = Symbol('REQUEST_LOGGER');
