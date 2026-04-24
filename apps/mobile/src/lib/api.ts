import { env } from "./env";
import type { RadioFeedResponse, RadioProgressGetResponse } from "./types";

const API_BASE = env.apiBaseUrl || "https://neoma-plum.vercel.app";

async function parseJson<T>(res: Response): Promise<T> {
  const text = await res.text();
  let data: unknown = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`Unexpected server response (${res.status}).`);
  }
  if (!res.ok) {
    const msg =
      typeof (data as { error?: unknown }).error === "string"
        ? (data as { error: string }).error
        : `Request failed (${res.status}).`;
    throw new Error(msg);
  }
  return data as T;
}

export async function fetchFeed(topic: string, level: number): Promise<RadioFeedResponse> {
  const url = `${API_BASE}/api/newspaper?radio=feed&topic=${encodeURIComponent(topic)}&level=${level}`;
  const res = await fetch(url);
  return parseJson<RadioFeedResponse>(res);
}

export async function fetchProgress(accessToken: string, topic: string): Promise<RadioProgressGetResponse> {
  const url = `${API_BASE}/api/newspaper?radio=progress&topic=${encodeURIComponent(topic)}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  return parseJson<RadioProgressGetResponse>(res);
}

export async function postProgress(accessToken: string, storyId: string, level: number): Promise<void> {
  const url = `${API_BASE}/api/newspaper?radio=progress`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ storyId, level }),
  });
  await parseJson<unknown>(res);
}
