export type Locale = 'ar' | 'en';
export const LOCALES: readonly Locale[] = ['ar', 'en'];
export const DEFAULT_LOCALE: Locale = 'ar';

export const CATEGORIES = [
  { code: 'plumbing', nameAr: 'سباكة', nameEn: 'Plumbing', icon: 'droplet', sortOrder: 1 },
  { code: 'electrical', nameAr: 'كهرباء', nameEn: 'Electrical', icon: 'zap', sortOrder: 2 },
  { code: 'ac_hvac', nameAr: 'تكييف وتهوية', nameEn: 'AC / HVAC', icon: 'snowflake', sortOrder: 3 },
  { code: 'carpentry_doors', nameAr: 'نجارة وأبواب', nameEn: 'Carpentry & Doors', icon: 'door-open', sortOrder: 4 },
  { code: 'painting_walls', nameAr: 'دهان وجدران', nameEn: 'Painting & Walls', icon: 'paint-roller', sortOrder: 5 },
  { code: 'pest_control', nameAr: 'مكافحة حشرات', nameEn: 'Pest Control', icon: 'bug', sortOrder: 6 },
  { code: 'cleaning', nameAr: 'نظافة', nameEn: 'Cleaning', icon: 'sparkles', sortOrder: 7 },
  { code: 'other', nameAr: 'أخرى', nameEn: 'Other', icon: 'ellipsis', sortOrder: 8 },
] as const;
export type CategoryCode = (typeof CATEGORIES)[number]['code'];

/** Problem.code → message. Every DomainError code thrown by the API must exist here (standards §4). */
export const ERRORS: Record<Locale, Record<string, string>> = {
  en: {
    validation_failed: 'Some fields are not valid.',
    unauthenticated: 'Please sign in again.',
    forbidden: 'You do not have access to this.',
    not_found: 'Not found.',
    rate_limited: 'Too many attempts. Please wait and try again.',
    invalid_credentials: 'The email or password is not correct.',
    account_locked: 'Your account is locked for 15 minutes after too many failed attempts.',
    otp_invalid: 'The code is not correct.',
    otp_expired: 'The code has expired. Request a new one.',
    otp_attempts_exceeded: 'Too many wrong codes. Request a new one.',
    otp_resend_limit: 'You have reached the resend limit for this code.',
    csrf_invalid: 'Your session needs refreshing. Reload the page.',
    reset_token_invalid: 'This reset link is invalid or has expired.',
    password_too_weak: 'Use at least 12 characters.',
    invitation_expired: 'This invitation has expired. Ask your compound management to resend your invitation.',
    invitation_used: 'This invitation was already used. Sign in instead.',
    invitation_revoked: 'This invitation is no longer valid. Ask your compound management to resend your invitation.',
    invitation_not_found: 'This invitation link is not valid. Ask your compound management to resend your invitation.',
    unit_number_taken: 'A unit with this number already exists in the compound.',
    unit_in_use: 'This unit has an owner or requests, so it cannot be deleted. Deactivate it instead.',
    unit_inactive: 'This unit is deactivated.',
    no_owner_assigned: 'Assign an owner before sending an invitation.',
    already_active: 'The owner has already activated their account.',
    channel_unavailable: 'The owner has no contact for this channel.',
    invite_limit_reached: 'You can send at most 5 invitations per unit in 24 hours.',
    phone_invalid: 'Enter a Saudi mobile number like 05XXXXXXXX.',
    contact_required: 'Enter a mobile number or an email.',
    invalid_transition: 'This status change is not allowed.',
    version_conflict: 'This request was updated by someone else. Reload and try again.',
    request_closed: 'This request is closed.',
    edit_window_closed: 'Comments can only be changed within 5 minutes.',
    not_comment_author: 'You can only change your own comments.',
    visit_invalid: 'The visit end time must be after the start time.',
    visit_in_past: 'The visit time has already passed. Choose a later time.',
    unit_access_revoked: 'You no longer have access to this unit.',
    no_active_units: 'Your account has no active units.',
    session_revoked: 'You were signed out. Please sign in again.',
    refresh_expired: 'Your session has expired. Please sign in again.',
    consent_version_outdated: 'The privacy notice was updated. Please review it again.',
    upload_invalid: 'This file cannot be used.',
    announcement_invalid: 'Fill in the title and text for each selected language.',
    announcement_not_deletable: 'This announcement cannot be deleted.',
    audience_empty: 'Choose at least one block or unit.',
    schedule_in_past: 'Choose a time in the future.',
    internal_error: 'Something went wrong. Please try again.',
  },
  ar: {
    validation_failed: 'بعض الحقول غير صحيحة.',
    unauthenticated: 'يرجى تسجيل الدخول مرة أخرى.',
    forbidden: 'لا تملك صلاحية الوصول إلى هذا.',
    not_found: 'غير موجود.',
    rate_limited: 'محاولات كثيرة. يرجى الانتظار ثم المحاولة مرة أخرى.',
    invalid_credentials: 'البريد الإلكتروني أو كلمة المرور غير صحيحة.',
    account_locked: 'تم قفل حسابك لمدة 15 دقيقة بعد محاولات فاشلة كثيرة.',
    otp_invalid: 'الرمز غير صحيح.',
    otp_expired: 'انتهت صلاحية الرمز. اطلب رمزًا جديدًا.',
    otp_attempts_exceeded: 'رموز خاطئة كثيرة. اطلب رمزًا جديدًا.',
    otp_resend_limit: 'وصلت إلى الحد الأقصى لإعادة إرسال هذا الرمز.',
    csrf_invalid: 'يلزم تحديث الجلسة. أعد تحميل الصفحة.',
    reset_token_invalid: 'رابط إعادة التعيين غير صالح أو منتهي.',
    password_too_weak: 'استخدم 12 حرفًا على الأقل.',
    invitation_expired: 'انتهت صلاحية هذه الدعوة. اطلب من إدارة المجمع إعادة إرسال الدعوة.',
    invitation_used: 'تم استخدام هذه الدعوة من قبل. سجّل الدخول بدلًا من ذلك.',
    invitation_revoked: 'هذه الدعوة لم تعد صالحة. اطلب من إدارة المجمع إعادة إرسال الدعوة.',
    invitation_not_found: 'رابط الدعوة غير صالح. اطلب من إدارة المجمع إعادة إرسال الدعوة.',
    unit_number_taken: 'توجد وحدة بهذا الرقم في المجمع.',
    unit_in_use: 'لهذه الوحدة مالك أو طلبات، لذا لا يمكن حذفها. عطّلها بدلًا من ذلك.',
    unit_inactive: 'هذه الوحدة معطّلة.',
    no_owner_assigned: 'عيّن مالكًا قبل إرسال الدعوة.',
    already_active: 'قام المالك بتفعيل حسابه بالفعل.',
    channel_unavailable: 'لا تتوفر لدى المالك وسيلة تواصل لهذه القناة.',
    invite_limit_reached: 'يمكنك إرسال 5 دعوات كحد أقصى لكل وحدة خلال 24 ساعة.',
    phone_invalid: 'أدخل رقم جوال سعودي مثل 05XXXXXXXX.',
    contact_required: 'أدخل رقم جوال أو بريدًا إلكترونيًا.',
    invalid_transition: 'تغيير الحالة هذا غير مسموح.',
    version_conflict: 'تم تحديث هذا الطلب من شخص آخر. أعد التحميل وحاول مرة أخرى.',
    request_closed: 'هذا الطلب مغلق.',
    edit_window_closed: 'يمكن تعديل التعليقات خلال 5 دقائق فقط.',
    not_comment_author: 'يمكنك تعديل تعليقاتك فقط.',
    visit_invalid: 'يجب أن يكون وقت نهاية الزيارة بعد وقت البداية.',
    visit_in_past: 'وقت الزيارة قد مضى. اختر وقتاً لاحقاً.',
    unit_access_revoked: 'لم يعد لديك وصول إلى هذه الوحدة.',
    no_active_units: 'لا توجد وحدات مفعّلة في حسابك.',
    session_revoked: 'تم تسجيل خروجك. يرجى تسجيل الدخول مرة أخرى.',
    refresh_expired: 'انتهت جلستك. يرجى تسجيل الدخول مرة أخرى.',
    consent_version_outdated: 'تم تحديث إشعار الخصوصية. يرجى مراجعته مرة أخرى.',
    upload_invalid: 'لا يمكن استخدام هذا الملف.',
    announcement_invalid: 'أدخل العنوان والنص لكل لغة مختارة.',
    announcement_not_deletable: 'لا يمكن حذف هذا الإعلان.',
    audience_empty: 'اختر مبنى أو وحدة واحدة على الأقل.',
    schedule_in_past: 'اختر وقتًا في المستقبل.',
    internal_error: 'حدث خطأ ما. يرجى المحاولة مرة أخرى.',
  },
};

export const STATUS_LABELS: Record<Locale, Record<string, string>> = {
  en: { new: 'New', in_progress: 'In Progress', done: 'Done', closed: 'Closed', cancelled: 'Cancelled' },
  ar: { new: 'جديد', in_progress: 'قيد التنفيذ', done: 'تم الإنجاز', closed: 'مغلق', cancelled: 'ملغى' },
};

type Params = Record<string, string | number>;
type Template = { title: string; body: string };

/** In-app/push copy. PDPL: no names, descriptions or phone numbers (architecture §6). */
export const NOTIFICATIONS: Record<Locale, Record<string, Template>> = {
  en: {
    request_status_changed_in_progress: { title: '{compound}', body: 'Request {ref} is In Progress' },
    request_status_changed_done: { title: '{compound}', body: 'Request {ref} is Done — please confirm' },
    request_comment: { title: '{compound}', body: 'New comment on request {ref}' },
    visit_scheduled: { title: '{compound}', body: 'Visit scheduled for request {ref}' },
    visit_rescheduled: { title: '{compound}', body: 'Visit rescheduled for request {ref}' },
    visit_reminder: { title: '{compound}', body: 'Reminder: visit tomorrow for request {ref}' },
    request_auto_closed: { title: '{compound}', body: 'Request {ref} was closed (no response)' },
    announcement: { title: '{compound}', body: '{title}' },
    access_revoked: { title: '{compound}', body: 'Your access to unit {unit} has ended' },
  },
  ar: {
    request_status_changed_in_progress: { title: '{compound}', body: 'الطلب {ref}: قيد التنفيذ' },
    request_status_changed_done: { title: '{compound}', body: 'الطلب {ref}: تم الإنجاز — يرجى التأكيد' },
    request_comment: { title: '{compound}', body: 'تعليق جديد على الطلب {ref}' },
    visit_scheduled: { title: '{compound}', body: 'تم تحديد موعد زيارة للطلب {ref}' },
    visit_rescheduled: { title: '{compound}', body: 'تم تغيير موعد الزيارة للطلب {ref}' },
    visit_reminder: { title: '{compound}', body: 'تذكير: زيارة غدًا للطلب {ref}' },
    request_auto_closed: { title: '{compound}', body: 'تم إغلاق الطلب {ref} (بدون رد)' },
    announcement: { title: '{compound}', body: '{title}' },
    access_revoked: { title: '{compound}', body: 'انتهى وصولك إلى الوحدة {unit}' },
  },
};

/** Fixed SMS templates (to be registered with the aggregator). */
export const SMS: Record<Locale, Record<string, string>> = {
  en: {
    invitation: '{compound}: you are invited to the compound app for unit {unit}. Activate: {link}',
    otp: 'Your verification code is {code}. It expires in 5 minutes.',
    request_status_changed_done: '{compound}: request {ref} is done. Please confirm: {link}',
    visit_scheduled: '{compound}: visit for request {ref} on {when}. {link}',
    visit_rescheduled: '{compound}: visit for request {ref} moved to {when}. {link}',
    announcement: '{compound}: {title}',
  },
  ar: {
    invitation: '{compound}: تمت دعوتك لتطبيق المجمع للوحدة {unit}. للتفعيل: {link}',
    otp: 'رمز التحقق: {code}. صالح لمدة 5 دقائق.',
    request_status_changed_done: '{compound}: تم إنجاز الطلب {ref}. يرجى التأكيد: {link}',
    visit_scheduled: '{compound}: زيارة للطلب {ref} في {when}. {link}',
    visit_rescheduled: '{compound}: تغيّر موعد زيارة الطلب {ref} إلى {when}. {link}',
    announcement: '{compound}: {title}',
  },
};

export const EMAIL: Record<Locale, Record<string, Template>> = {
  en: {
    invitation: { title: 'Your invitation to {compound}', body: 'Hello {name},\n\nYou have been invited to the {compound} app for unit {unit}.\nActivate your account (link valid for 7 days):\n{link}' },
    otp: { title: 'Your verification code', body: 'Your verification code is {code}. It expires in 5 minutes.' },
    password_reset: { title: 'Reset your password', body: 'Use this link within 30 minutes to reset your password:\n{link}\n\nIf you did not ask for this, ignore this email.' },
  },
  ar: {
    invitation: { title: 'دعوتك إلى {compound}', body: 'مرحبًا {name}،\n\nتمت دعوتك إلى تطبيق {compound} للوحدة {unit}.\nفعّل حسابك (الرابط صالح لمدة 7 أيام):\n{link}' },
    otp: { title: 'رمز التحقق', body: 'رمز التحقق: {code}. صالح لمدة 5 دقائق.' },
    password_reset: { title: 'إعادة تعيين كلمة المرور', body: 'استخدم هذا الرابط خلال 30 دقيقة لإعادة تعيين كلمة المرور:\n{link}\n\nإذا لم تطلب ذلك فتجاهل هذه الرسالة.' },
  },
};

const LRI = '⁦';
const PDI = '⁩';

/** Fill {placeholders}. Values are bidi-isolated so "REQ-00123" or "B-14" render correctly inside Arabic (K-2). */
export function fill(template: string, params: Params, isolate = true): string {
  return template.replace(/\{(\w+)\}/g, (_, k: string) => {
    const v = params[k];
    if (v === undefined) return `{${k}}`;
    return isolate ? `${LRI}${v}${PDI}` : String(v);
  });
}

export function errorMessage(code: string, locale: Locale): string {
  return ERRORS[locale][code] ?? ERRORS[locale].internal_error!;
}

export function notificationText(key: string, locale: Locale, params: Params): Template {
  const t = NOTIFICATIONS[locale][key]!;
  // Titles are plain compound names; no isolation marks in push titles.
  return { title: fill(t.title, params, false), body: fill(t.body, params) };
}

export function smsText(key: string, locale: Locale, params: Params): string {
  return fill(SMS[locale][key]!, params, false);
}

export function emailText(key: string, locale: Locale, params: Params): Template {
  const t = EMAIL[locale][key]!;
  return { title: fill(t.title, params, false), body: fill(t.body, params, false) };
}
