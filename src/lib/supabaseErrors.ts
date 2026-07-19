export type SupabaseLikeError = {
  message?: string;
  code?: string;
  details?: string;
  hint?: string;
};

const FRIENDLY_ERRORS: Record<string, string> = {
  '23505': 'Такая запись уже существует.',
  '23503': 'Связанная запись не найдена.',
  '23514': 'Данные не прошли проверку.',
  '42501': 'Недостаточно прав для этой операции.',
  PGRST116: 'Запись не найдена.',
};

export function getSupabaseErrorMessage(error: unknown, fallback = 'Не удалось выполнить операцию.') {
  if (!error || typeof error !== 'object') return fallback;
  const value = error as SupabaseLikeError;
  if (value.code && FRIENDLY_ERRORS[value.code]) return FRIENDLY_ERRORS[value.code];
  return value.message?.trim() || fallback;
}

export function reportSupabaseError(context: string, error: unknown) {
  console.error(`[Supabase] ${context}`, error);
  return getSupabaseErrorMessage(error);
}
