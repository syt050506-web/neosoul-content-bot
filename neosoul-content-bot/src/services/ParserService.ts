const X_URL_PATTERN =
  /\bhttps?:\/\/(?:www\.x\.com|x\.com|twitter\.com|mobile\.twitter\.com)\/[^\s<>()]+/gi;
const X_HOSTS = new Set(['x.com', 'www.x.com', 'twitter.com', 'mobile.twitter.com']);
const TRAILING_MESSAGE_PUNCTUATION = /[.,!?;:'"\]}]+$/;

export interface ParsedXPost {
  username: string;
  postId: string;
  originalUrl: string;
}

export type ParseResult =
  | { ok: true; post: ParsedXPost }
  | { ok: false; reason: 'NO_URL' | 'MULTIPLE_URLS' | 'INVALID_STATUS_URL' };

export class ParserService {
  public parseXPost(content: string): ParseResult {
    const urls = Array.from(content.matchAll(X_URL_PATTERN), ([match]) =>
      match.replace(TRAILING_MESSAGE_PUNCTUATION, ''),
    );

    if (urls.length === 0) {
      return { ok: false, reason: 'NO_URL' };
    }

    if (urls.length > 1) {
      return { ok: false, reason: 'MULTIPLE_URLS' };
    }

    const originalUrl = urls[0];
    if (!originalUrl) {
      return { ok: false, reason: 'NO_URL' };
    }

    let url: URL;
    try {
      url = new URL(originalUrl);
    } catch {
      return { ok: false, reason: 'INVALID_STATUS_URL' };
    }

    const pathParts = url.pathname.split('/').filter(Boolean);
    const [username, statusSegment, postId] = pathParts;
    const isValid =
      X_HOSTS.has(url.hostname.toLowerCase()) &&
      pathParts.length === 3 &&
      /^[a-z0-9_]{1,15}$/i.test(username ?? '') &&
      statusSegment?.toLowerCase() === 'status' &&
      /^\d+$/.test(postId ?? '');

    if (!isValid || !username || !postId) {
      return { ok: false, reason: 'INVALID_STATUS_URL' };
    }

    return {
      ok: true,
      post: {
        username,
        postId,
        originalUrl,
      },
    };
  }
}
