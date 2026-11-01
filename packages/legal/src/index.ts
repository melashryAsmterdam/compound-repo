/**
 * Versioned privacy notice and terms (PDPL, R1-AC4). DRAFT TEXT — must be
 * replaced by counsel-approved wording before the pilot. Bump the version
 * whenever the text changes; residents are asked to accept again.
 */
export type LegalDocument = 'privacy_notice' | 'terms';
export type LegalLocale = 'ar' | 'en';

export const LEGAL_VERSIONS: Record<LegalDocument, string> = {
  privacy_notice: '2026-11-01',
  terms: '2026-11-01',
};

const TEXT: Record<LegalDocument, Record<LegalLocale, string>> = {
  privacy_notice: {
    en: `<h1>Privacy notice</h1>
<p><strong>Draft for legal review.</strong></p>
<p>Your compound management uses this app to run maintenance requests and send you announcements. We process your name, mobile number or email, your unit, the requests and photos you submit, and technical data about your device.</p>
<p>We use this data only to provide the compound service. It is stored in the Kingdom of Saudi Arabia. Requests are kept for 5 years for the compound's records.</p>
<p>You can ask to access, correct or delete your personal data from Settings → Privacy &amp; my data.</p>`,
    ar: `<h1>إشعار الخصوصية</h1>
<p><strong>مسودة للمراجعة القانونية.</strong></p>
<p>تستخدم إدارة المجمع هذا التطبيق لإدارة طلبات الصيانة وإرسال الإعلانات إليك. نعالج اسمك ورقم جوالك أو بريدك الإلكتروني ووحدتك والطلبات والصور التي ترسلها وبيانات تقنية عن جهازك.</p>
<p>نستخدم هذه البيانات فقط لتقديم خدمة المجمع، وتُحفظ داخل المملكة العربية السعودية. تُحفظ الطلبات لمدة 5 سنوات لسجلات المجمع.</p>
<p>يمكنك طلب الاطلاع على بياناتك الشخصية أو تصحيحها أو حذفها من الإعدادات ← الخصوصية وبياناتي.</p>`,
  },
  terms: {
    en: `<h1>Terms of use</h1>
<p><strong>Draft for legal review.</strong></p>
<p>Use the app only for your own unit's requests. Do not upload photos of other people. Emergencies should be reported by phone to the compound management.</p>`,
    ar: `<h1>شروط الاستخدام</h1>
<p><strong>مسودة للمراجعة القانونية.</strong></p>
<p>استخدم التطبيق لطلبات وحدتك فقط. لا ترفع صورًا لأشخاص آخرين. يُبلَّغ عن الحالات الطارئة هاتفيًا لإدارة المجمع.</p>`,
  },
};

export function legalDocument(doc: LegalDocument, locale: LegalLocale) {
  return { version: LEGAL_VERSIONS[doc], locale, html: TEXT[doc][locale] };
}
