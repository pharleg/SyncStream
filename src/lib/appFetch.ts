import { httpClient } from '@wix/essentials';

export function appFetch(path: string, init?: RequestInit): Promise<Response> {
  const url = new URL(path, new URL(import.meta.url).origin).toString();
  return httpClient.fetchWithAuth(url, init);
}
