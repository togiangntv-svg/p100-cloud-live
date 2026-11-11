import type { ReleaseLocale } from './i18n-opening';

export const IDENTITY_TRANSLATION_KEYS = [
  'identityControl',
  'identityContinuityTitle',
  'identityLockedBody',
  'identityVerifyingBody',
  'identityReadyBody',
  'identitySignInApple',
  'identityLogout',
  'identityCancelled',
  'identityUnavailable',
  'identityLogoutUnavailable',
] as const;

export type IdentityTranslationKey = typeof IDENTITY_TRANSLATION_KEYS[number];
type IdentityMessages = Record<IdentityTranslationKey, string>;

export const identityMessages: Record<ReleaseLocale, IdentityMessages> = {
  vi: {
    identityControl: 'Tài khoản và quyền riêng tư',
    identityContinuityTitle: 'Tiếp tục dữ liệu riêng',
    identityLockedBody: 'Đăng nhập khi bạn muốn tiếp tục dữ liệu riêng một cách an toàn trên thiết bị này.',
    identityVerifyingBody: 'Đang kiểm tra đăng nhập an toàn…',
    identityReadyBody: 'Bạn đã đăng nhập. Dữ liệu riêng có thể tiếp tục trên thiết bị này.',
    identitySignInApple: 'Đăng nhập bằng Apple',
    identityLogout: 'Đăng xuất',
    identityCancelled: 'Đã hủy đăng nhập. Bạn vẫn có thể tiếp tục dùng 100.',
    identityUnavailable: 'Hiện chưa thể đăng nhập. Bạn có thể thử lại khi sẵn sàng.',
    identityLogoutUnavailable: 'Bạn đã đăng xuất trên thiết bị này. Hiện chưa thể liên hệ máy chủ.',
  },
  en: {
    identityControl: 'Account and privacy', identityContinuityTitle: 'Continue private progress',
    identityLockedBody: 'Sign in when you want your private progress to continue safely on this device.',
    identityVerifyingBody: 'Checking your secure sign-in…',
    identityReadyBody: 'You are signed in. Your private progress can continue on this device.',
    identitySignInApple: 'Sign in with Apple', identityLogout: 'Sign out',
    identityCancelled: 'Sign-in was cancelled. You can keep using 100.',
    identityUnavailable: 'Sign-in is unavailable right now. You can try again when ready.',
    identityLogoutUnavailable: 'You are signed out on this device. The server is unavailable right now.',
  },
  'zh-Hans': {
    identityControl: '账户与隐私', identityContinuityTitle: '延续私人进度',
    identityLockedBody: '如需在这台设备上安全延续你的私人进度，请登录。', identityVerifyingBody: '正在检查安全登录…',
    identityReadyBody: '你已登录，可以在这台设备上延续私人进度。', identitySignInApple: '通过 Apple 登录', identityLogout: '退出登录',
    identityCancelled: '登录已取消。你仍可继续使用 100。', identityUnavailable: '目前无法登录。准备好后可以重试。',
    identityLogoutUnavailable: '你已在此设备上退出登录。目前无法连接服务器。',
  },
  es: {
    identityControl: 'Cuenta y privacidad', identityContinuityTitle: 'Continuar el progreso privado',
    identityLockedBody: 'Inicia sesión cuando quieras continuar tu progreso privado de forma segura en este dispositivo.', identityVerifyingBody: 'Comprobando el inicio de sesión seguro…',
    identityReadyBody: 'Has iniciado sesión. Tu progreso privado puede continuar en este dispositivo.', identitySignInApple: 'Iniciar sesión con Apple', identityLogout: 'Cerrar sesión',
    identityCancelled: 'Se canceló el inicio de sesión. Puedes seguir usando 100.', identityUnavailable: 'No se puede iniciar sesión ahora. Puedes intentarlo de nuevo cuando quieras.',
    identityLogoutUnavailable: 'Has cerrado sesión en este dispositivo. El servidor no está disponible ahora.',
  },
  hi: {
    identityControl: 'खाता और गोपनीयता', identityContinuityTitle: 'निजी प्रगति जारी रखें',
    identityLockedBody: 'इस डिवाइस पर अपनी निजी प्रगति सुरक्षित रूप से जारी रखने के लिए साइन इन करें।', identityVerifyingBody: 'सुरक्षित साइन इन की जाँच हो रही है…',
    identityReadyBody: 'आप साइन इन हैं। इस डिवाइस पर आपकी निजी प्रगति जारी रह सकती है।', identitySignInApple: 'Apple से साइन इन करें', identityLogout: 'साइन आउट करें',
    identityCancelled: 'साइन इन रद्द कर दिया गया। आप 100 का उपयोग जारी रख सकते हैं।', identityUnavailable: 'अभी साइन इन उपलब्ध नहीं है। तैयार होने पर फिर कोशिश करें।',
    identityLogoutUnavailable: 'आप इस डिवाइस से साइन आउट हो गए हैं। अभी सर्वर से संपर्क नहीं हो सका।',
  },
  ja: {
    identityControl: 'アカウントとプライバシー', identityContinuityTitle: '個人の進捗を引き継ぐ',
    identityLockedBody: 'この端末で個人の進捗を安全に引き継ぎたいときにサインインしてください。', identityVerifyingBody: '安全なサインインを確認しています…',
    identityReadyBody: 'サインイン済みです。この端末で個人の進捗を引き継げます。', identitySignInApple: 'Appleでサインイン', identityLogout: 'サインアウト',
    identityCancelled: 'サインインをキャンセルしました。引き続き100を利用できます。', identityUnavailable: '現在サインインできません。準備ができたら再試行できます。',
    identityLogoutUnavailable: 'この端末ではサインアウト済みです。現在サーバーに接続できません。',
  },
  ko: {
    identityControl: '계정 및 개인정보', identityContinuityTitle: '개인 진행 이어가기',
    identityLockedBody: '이 기기에서 개인 진행을 안전하게 이어가고 싶을 때 로그인하세요.', identityVerifyingBody: '안전한 로그인을 확인하고 있습니다…',
    identityReadyBody: '로그인되었습니다. 이 기기에서 개인 진행을 이어갈 수 있습니다.', identitySignInApple: 'Apple로 로그인', identityLogout: '로그아웃',
    identityCancelled: '로그인이 취소되었습니다. 계속 100을 사용할 수 있습니다.', identityUnavailable: '현재 로그인할 수 없습니다. 준비되면 다시 시도하세요.',
    identityLogoutUnavailable: '이 기기에서 로그아웃되었습니다. 현재 서버에 연결할 수 없습니다.',
  },
  ru: {
    identityControl: 'Учётная запись и конфиденциальность', identityContinuityTitle: 'Продолжить личный прогресс',
    identityLockedBody: 'Войдите, когда захотите безопасно продолжить личный прогресс на этом устройстве.', identityVerifyingBody: 'Проверяем безопасный вход…',
    identityReadyBody: 'Вы вошли. Личный прогресс можно продолжить на этом устройстве.', identitySignInApple: 'Войти через Apple', identityLogout: 'Выйти',
    identityCancelled: 'Вход отменён. Вы можете продолжать пользоваться 100.', identityUnavailable: 'Сейчас войти невозможно. Попробуйте снова, когда будете готовы.',
    identityLogoutUnavailable: 'Вы вышли на этом устройстве. Сейчас сервер недоступен.',
  },
};


// Internal realm copy is separate from production identity messages.
const localVerificationMessages: Record<ReleaseLocale, readonly [string,string,string,string,string,string,string]> = {
  "vi": [
    "Phiên kiểm chứng nội bộ",
    "Không đăng nhập Apple; bộ xử lý kiểm thử cục bộ, không dùng dữ liệu người thật.",
    "Tạo phiên kỹ thuật",
    "Cho phép xử lý cục bộ",
    "Thu hồi quyền xử lý",
    "Đóng phiên kỹ thuật",
    "Bộ giải nghĩa này chỉ hỗ trợ tiếng Việt và tiếng Anh."
  ],
  "en": [
    "Internal verification session",
    "No Apple sign-in; local test processor, no real-user data.",
    "Create technical session",
    "Allow local processing",
    "Revoke processing",
    "Close technical session",
    "This interpreter supports Vietnamese and English only."
  ],
  "zh-Hans": [
    "内部验证会话",
    "非 Apple 登录；本地测试处理器，不使用真实用户数据。",
    "创建技术会话",
    "允许本地处理",
    "撤销处理权限",
    "关闭技术会话",
    "此解释器仅支持越南语和英语。"
  ],
  "es": [
    "Sesión de verificación interna",
    "Sin inicio de sesión Apple; procesador local de prueba, sin datos de usuarios reales.",
    "Crear sesión técnica",
    "Permitir procesamiento local",
    "Revocar procesamiento",
    "Cerrar sesión técnica",
    "Este intérprete solo admite vietnamita e inglés."
  ],
  "hi": [
    "आंतरिक सत्यापन सत्र",
    "Apple साइन-इन नहीं; स्थानीय परीक्षण, वास्तविक उपयोगकर्ता डेटा नहीं।",
    "तकनीकी सत्र बनाएँ",
    "स्थानीय प्रसंस्करण की अनुमति दें",
    "अनुमति वापस लें",
    "तकनीकी सत्र बंद करें",
    "यह व्याख्याकार केवल वियतनामी और अंग्रेज़ी का समर्थन करता है।"
  ],
  "ja": [
    "内部検証セッション",
    "Appleログインではありません。実ユーザーデータを使わないローカルテストです。",
    "技術セッションを作成",
    "ローカル処理を許可",
    "処理権限を取り消す",
    "技術セッションを閉じる",
    "対応する意味解析言語はベトナム語と英語のみです。"
  ],
  "ko": [
    "내부 검증 세션",
    "Apple 로그인이 아닙니다. 실제 사용자 데이터를 사용하지 않는 로컬 테스트입니다.",
    "기술 세션 만들기",
    "로컬 처리 허용",
    "처리 권한 철회",
    "기술 세션 닫기",
    "이 해석기는 베트남어와 영어만 지원합니다."
  ],
  "ru": [
    "Сеанс внутренней проверки",
    "Без входа через Apple; локальная проверка без реальных пользовательских данных.",
    "Создать технический сеанс",
    "Разрешить локальную обработку",
    "Отозвать разрешение",
    "Закрыть технический сеанс",
    "Поддерживаются только вьетнамский и английский языки."
  ]
};
export function localVerificationCopy(locale: string) {
  const values=localVerificationMessages[locale as ReleaseLocale] ?? localVerificationMessages.en;
  const [title,body,create,allow,revoke,logout,unsupported]=values;
  return Object.freeze({title,body,create,allow,revoke,logout,unsupported});
}
