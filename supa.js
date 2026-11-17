// Supabase connection + small helpers shared by every page.
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

export const configured = !SUPABASE_URL.includes('YOUR-PROJECT') && !SUPABASE_ANON_KEY.includes('YOUR-');

export const sb = configured
  ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: true, autoRefreshToken: true } })
  : null;

// Call a database function and return its data, throwing a readable error.
export async function rpc(name, args = {}) {
  if (!sb) throw new Error('The website is not connected to the database yet (see js/config.js).');
  const { data, error } = await sb.rpc(name, args);
  if (error) throw new Error(cleanError(error));
  return data;
}

export function cleanError(error) {
  const msg = (error && (error.message || error.error_description || error.msg)) || String(error);
  if (/Failed to fetch|NetworkError/i.test(msg)) return 'No internet connection. Please try again.';
  if (/Invalid login credentials/i.test(msg)) return 'Wrong email or password.';
  if (/Email not confirmed/i.test(msg)) return 'Please confirm your email first. Check your inbox for the link.';
  if (/JWT|token/i.test(msg) && /expired/i.test(msg)) return 'Your session expired. Please log in again.';
  return msg.replace(/^.*?ERROR:\s*/, '');
}

export async function publicInfo() {
  if (!sb) return null;
  const { data } = await sb.rpc('public_info');
  return data;
}

export async function currentSession() {
  if (!sb) return null;
  const { data } = await sb.auth.getSession();
  return data.session;
}

// Mark helpers
export const CORE_VALUES = ['Maka-Diyos', 'Makatao', 'Makakalikasan', 'Makabansa'];
export const MARKS = ['AO', 'SO', 'RO', 'NO'];
export const MARK_NAMES = { AO: 'Always Observed', SO: 'Sometimes Observed', RO: 'Rarely Observed', NO: 'Not Observed' };
export function letterOf(x) {
  if (x === null || x === undefined || Number.isNaN(Number(x))) return null;
  x = Number(x);
  return x >= 3.5 ? 'AO' : x >= 2.5 ? 'SO' : x >= 1.5 ? 'RO' : 'NO';
}
export function fmt(x) { return x === null || x === undefined ? '—' : Number(x).toFixed(2); }
