/**
 * Cookie names only. Kept free of any Node import so the edge middleware can
 * read them without dragging `node:crypto` into the edge bundle.
 */
export const SESSION_COOKIE = "todox_session";
export const LANG_COOKIE = "todox_lang";
