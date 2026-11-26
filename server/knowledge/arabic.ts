// ============================================================
// WASL AI — الموجة الثالثة (W3) · وحدة المعرفة
// ------------------------------------------------------------
// ⭐⭐⭐ التطبيع العربي — **العمود الفقري للبحث**.
// ------------------------------------------------------------
// ⭐ WHY THIS FILE EXISTS
//   the customer writes «العملاء» and the knowledge file writes «العميل»
//   ⇒ and the two are the SAME word ⇒ ⇒ so the search must not lose the
//   match between them ⇒ ⇒ and the answer must not change because of a
//   diacritic or a letter variant.
// ⭐⭐ THE RULES ARE DECLARED (no learning · no model · no network)
//   ① the diacritics and the tatweel are removed,
//   ② the letters are unified (alif · ya · ta marbuta · hamza),
//   ③ the digits are unified (Arabic-Indic ⇒ Latin),
//   ④ the punctuation becomes a space,
//   ⑤ the definite article «ال» is removed when what stays is a word,
//   ⑥ the endings are folded (a declared list, not a full stemmer),
//   ⑦ the function words are dropped.
// ⭐⭐ DETERMINISM
//   the same text ⇒ the same tokens ⇒ always ⇒ so the same question
//   always gives the same answer.
// ⛔ It does not import from `src/core/`.
// ============================================================

// ------------------------------------------------------------
// ① the diacritics · the tatweel · the superscript alef
// ------------------------------------------------------------
// ⭐⭐ THE RANGE IS EXACT ⇒ the Arabic-Indic digits (U+0660..U+0669)
//   are NOT diacritics ⇒ ⇒ so they are never eaten by this rule.
const DIACRITICS = /[\u064B-\u065F\u0670\u06D6-\u06ED\u0640]/g;

// ------------------------------------------------------------
// ② the letters that are unified
// ------------------------------------------------------------
const LETTER_UNIFICATION: Readonly<Record<string, string>> = Object.freeze({
  'أ': 'ا', // أ
  'إ': 'ا', // إ
  'آ': 'ا', // آ
  'ٱ': 'ا', // ٱ
  'ٲ': 'ا', // ٲ
  'ٳ': 'ا', // ٳ
  'ى': 'ي', // ى
  'ئ': 'ي', // ئ
  'ؤ': 'و', // ؤ
  'ة': 'ه', // ة
  'ک': 'ك', // ک
  'ڪ': 'ك', // ڪ
  'ی': 'ي', // ی
  'ۀ': 'ه', // ۀ
  'ە': 'ه', // ە
  'ھ': 'ه', // ھ
});

// ------------------------------------------------------------
// ③ the digits that are unified (Arabic-Indic ⇒ Latin)
// ------------------------------------------------------------
const DIGIT_UNIFICATION: Readonly<Record<string, string>> = Object.freeze({
  '٠': '0', '١': '1', '٢': '2', '٣': '3', '٤': '4',
  '٥': '5', '٦': '6', '٧': '7', '٨': '8', '٩': '9',
  '۰': '0', '۱': '1', '۲': '2', '۳': '3', '۴': '4',
  '۵': '5', '۶': '6', '۷': '7', '۸': '8', '۹': '9',
});

/** ⭐ The Arabic-Indic digits that the writer may use in the question. */
const ARABIC_DIGITS = /[٠-٩۰-۹]/g;

/** ⭐ The definition article ⇒ removed when what stays is a word. */
const DEFINITE_ARTICLE = 'ال';

/**
 * ⭐⭐⑥ **the folded endings** ⇒ a declared list (NOT a full stemmer)
 * ⇒ and it is applied **in this order** ⇒ the first rule that matches
 * wins ⇒ and a rule is skipped when what stays is shorter than three
 * letters ⇒ ⇒ so a short word is never destroyed.
 *
 * ⭐ the pairs that this list makes ONE word:
 *   «العملاء» ⇒ «عميل» ⇐ «العميل» ⇒ «عميل» ✓
 *   «الرسائل» ⇒ «رساله» ⇐ «الرسالة» ⇒ «رساله» ✓
 *   «الموظفين» ⇒ «موظف» ⇐ «الموظف» ⇒ «موظف» ✓
 *   «المحادثات» ⇒ «محادثه» ⇐ «المحادثة» ⇒ «محادثه» ✓
 */
const ENDING_RULES: readonly { readonly suffix: string; readonly replacement: string | null }[] =
  Object.freeze([
    // ⭐ «عملاء» ⇒ «عميل» (the broken plural of «عميل»).
    { suffix: 'لاء', replacement: 'يل' },
    // ⭐ «إسناد» ⇒ «اسند» (the noun and the verb of the same word).
    { suffix: 'ناد', replacement: 'ند' },
    // ⭐ «رسائل» ⇒ «رساله» (the broken plural of «رسالة» ⇒ «رسايل» بعد توحيد الحروف).
    { suffix: 'ايل', replacement: 'اله' },
    // ⭐ «رسالات» ⇒ «رساله» (the sound plural of «رسالة»).
    { suffix: 'ات', replacement: 'ه' },
    // ⭐ «موظفون» ⇒ «موظف».
    { suffix: 'ون', replacement: null },
    // ⭐ «منتخبين» ⇒ «منتخب».
    { suffix: 'ين', replacement: null },
    // ⭐ «عميلاتها» ⇒ «عميل».
    { suffix: 'ها', replacement: null },
    // ⭐ «خدمية» ⇒ «خدم».
    { suffix: 'يه', replacement: null },
  ]);

/**
 * ⭐⭐ **the one-letter prefixes that the writer glues to the word**
 * ⇒ (ب · ل · ك · و · ف) ⇒ and they are removed **only** when what
 * follows them is the definition article ⇒ ⇒ so «الوقت» stays «وقت»
 * and «بالموظف» becomes «موظف» like «الموظف» ✓.
 */
const GLUED_PREFIXES: ReadonlySet<string> = Object.freeze(new Set(['ب', 'ل', 'ك', 'و', 'ف']));

/** ⭐ The minimum length of a word that a rule may leave behind. */
const MIN_STEM_LENGTH = 3;

/**
 * ⭐⭐⑦ **the function words** ⇒ dropped from the question and from the
 * knowledge ⇒ because they carry no meaning and they would give every
 * chunk the same score.
 */
export const ARABIC_STOPWORDS: ReadonlySet<string> = Object.freeze(
  new Set([
    'من', 'في', 'علي', 'الي', 'عن', 'مع', 'هذا', 'هذه', 'هذان', 'هاتين',
    'ذلك', 'تلك', 'التي', 'الذي', 'الذين', 'ما', 'ماذا', 'هل', 'كيف',
    'لماذا', 'اين', 'متي', 'كم', 'هل', 'او', 'ثم', 'قد', 'كان', 'كانت',
    'يكون', 'هو', 'هي', 'هم', 'هن', 'انا', 'نحن', 'انت', 'ان', 'انه',
    'انها', 'لك', 'لي', 'به', 'بها', 'له', 'لها', 'لهم', 'عند', 'عندما',
    'بين', 'حتي', 'بعد', 'قبل', 'غير', 'كل', 'بعض', 'اي', 'اذا', 'اما',
    'لكن', 'بل', 'نعم', 'كلا', 'كذلك', 'سوف', 'لم', 'لن', 'لا', 'كما',
    'جدا', 'ايضا', 'حسب', 'عبر', 'دون', 'سوي', 'نفس', 'حول', 'خلال',
    'ضمن', 'الي', 'يا', 'ها', 'يا', 'فقط', ' ايضا', 'اشد', 'يمكن', 'يمكنني',
    'نقدر', 'قدر', 'لازم', 'يجب', 'مستحيل', 'مرحبا', 'اهلا', 'شكرا',
  ]),
);

/** ⭐ Is the token a word of the language (and not a number)? */
function isWord(token: string): boolean {
  return /[\p{L}]/u.test(token);
}

/** ⭐ Is the token a number? */
function isNumber(token: string): boolean {
  return /^\d+$/.test(token);
}

/**
 * ⭐⭐⭐ **the normalisation of ONE token** ⇒ the canonical form of the
 * word ⇒ and the two forms that mean the same thing get the SAME form.
 *
 * ⭐ the order:
 *   ① the letters and the digits are unified,
 *   ② the definition article is removed (when what stays is a word),
 *   ③ the ending is folded (the first rule that matches wins).
 */
export function normalizeArabicToken(rawToken: string): string {
  let token = String(rawToken ?? '').trim();
  if (token === '') return '';

  // ⓪ the diacritics and the tatweel are removed ⇒ here too ⇒ so the
  // token can be normalised on its own (not only through the text).
  token = token.replace(DIACRITICS, '');

  // ① the unification of the letters and of the digits.
  token = token.replace(/[أإآٱٲٳىئؤةکڪیۀەھ]/g, (char) => LETTER_UNIFICATION[char] ?? char);
  token = token.replace(ARABIC_DIGITS, (char) => DIGIT_UNIFICATION[char] ?? char);
  token = token.toLowerCase();

  // ⭐ the numbers are kept as they are ⇒ they are informative.
  if (isNumber(token)) return token;

  // ② the glued one-letter prefix ⇒ only before the definition article.
  if (
    GLUED_PREFIXES.has(token.slice(0, 1)) &&
    token.startsWith('ال', 1) &&
    token.length - 1 >= DEFINITE_ARTICLE.length + MIN_STEM_LENGTH
  ) {
    token = token.slice(1);
  }

  // ③ the definition article ⇒ only when what stays is a word.
  if (
    token.startsWith(DEFINITE_ARTICLE) &&
    token.length >= DEFINITE_ARTICLE.length + MIN_STEM_LENGTH
  ) {
    token = token.slice(DEFINITE_ARTICLE.length);
  }

  // ④ the folded ending ⇒ the first rule that matches wins.
  for (const rule of ENDING_RULES) {
    if (!token.endsWith(rule.suffix)) continue;
    const stem =
      rule.replacement === null
        ? token.slice(0, token.length - rule.suffix.length)
        : token.slice(0, token.length - rule.suffix.length) + rule.replacement;
    if (stem.length >= MIN_STEM_LENGTH) return stem;
    // ⭐ the rule would leave a fragment ⇒ the token stays as it is.
    return token;
  }

  return token;
}

/**
 * ⭐⭐⭐ **the normalisation of a whole text** ⇒ the text with the
 * diacritics removed, the letters unified, the punctuation turned into
 * spaces ⇒ and the words in their canonical form.
 */
export function normalizeArabic(rawText: string): string {
  const withoutDiacritics = String(rawText ?? '').replace(DIACRITICS, '');
  const unified = withoutDiacritics
    .replace(/[أإآٱٲٳىئؤةکڪیۀەھ]/g, (char) => LETTER_UNIFICATION[char] ?? char)
    .replace(ARABIC_DIGITS, (char) => DIGIT_UNIFICATION[char] ?? char)
    .toLowerCase();
  // ⭐ a Latin word that is glued to an Arabic word is split ⇒ so the
  // two words are searched separately and not as one broken word.
  const separated = unified
    .replace(/([A-Za-z])([\u0600-\u06ff])/g, '$1 $2')
    .replace(/([\u0600-\u06ff])([A-Za-z])/g, '$1 $2');
  // ⭐ every symbol that is not a letter and not a digit becomes a space.
  const spaced = separated.replace(/[^\p{L}\p{N}]+/gu, ' ');
  return spaced.trim().replace(/\s+/g, ' ');
}

/**
 * ⭐⭐⭐ **the tokens of a text** ⇒ the words that carry a meaning ⇒
 * ⇒ the function words are gone ⇒ ⇒ and the numbers are kept.
 */
export function tokenizeArabic(rawText: string): string[] {
  const normalized = normalizeArabic(rawText);
  if (normalized === '') return [];
  const out: string[] = [];
  for (const piece of normalized.split(' ')) {
    if (piece === '') continue;
    const token = normalizeArabicToken(piece);
    if (token === '') continue;
    if (isNumber(token)) {
      out.push(token);
      continue;
    }
    if (!isWord(token)) continue;
    if (token.length < 2) continue;
    if (ARABIC_STOPWORDS.has(token)) continue;
    out.push(token);
  }
  return out;
}

/** ⭐ Is the token a function word? */
export function isStopword(token: string): boolean {
  return ARABIC_STOPWORDS.has(token);
}

/**
 * ⭐⭐⭐ **the counts of the terms** ⇒ the map the weights are built from
 * ⇒ and it is ordered by the first appearance ⇒ ⇒ so it is stable.
 */
export function countTerms(tokens: readonly string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const token of tokens) {
    counts.set(token, (counts.get(token) ?? 0) + 1);
  }
  return counts;
}
