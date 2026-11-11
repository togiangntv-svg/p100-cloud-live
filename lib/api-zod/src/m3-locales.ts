// Release locale boundary; adding a locale requires resources and contract tests.
export const M3_LOCALES = ['vi', 'en', 'zh-Hans', 'es', 'hi', 'ja', 'ko', 'ru'] as const;
export type M3Locale = typeof M3_LOCALES[number];
export const M3_LOCALE_CONFIG = {
  "vi": {
    "language": "Vietnamese",
    "safety": "Mình tạm dừng hướng dẫn hiện tại để ưu tiên sự an toàn của bạn.",
    "urgentSafety": "Dừng hành động hiện tại và tìm trợ giúp y tế khẩn cấp tại nơi bạn đang ở.",
    "stop": "Mình dừng hỏi ở đây. Bạn có thể tiếp tục khi muốn."
  },
  "en": {
    "language": "English",
    "safety": "I will pause the current guidance to put your safety first.",
    "urgentSafety": "Stop the current action and seek urgent medical help where you are.",
    "stop": "I will stop asking here. You can continue when you want."
  },
  "zh-Hans": {
    "language": "Simplified Chinese",
    "safety": "为了你的安全，我会先暂停当前指导。",
    "urgentSafety": "立即停止当前行动，并在您所在地区寻求紧急医疗帮助。",
    "stop": "我先不再提问。你想继续时，随时可以继续。"
  },
  "es": {
    "language": "Spanish",
    "safety": "Voy a pausar la orientación actual para dar prioridad a tu seguridad.",
    "urgentSafety": "Detén la acción actual y busca atención médica urgente donde te encuentres.",
    "stop": "Dejaré de preguntar aquí. Puedes continuar cuando quieras."
  },
  "hi": {
    "language": "Hindi",
    "safety": "आपकी सुरक्षा को प्राथमिकता देने के लिए मैं मौजूदा मार्गदर्शन रोक रहा हूँ।",
    "urgentSafety": "मौजूदा गतिविधि तुरंत रोकें और जहाँ हैं वहीं आपातकालीन चिकित्सा सहायता लें।",
    "stop": "मैं अब और सवाल नहीं पूछूँगा। आप जब चाहें आगे बढ़ सकते हैं।"
  },
  "ja": {
    "language": "Japanese",
    "safety": "あなたの安全を優先して、今の案内をいったん止めます。",
    "urgentSafety": "現在の行動をすぐに中止し、今いる場所で緊急の医療支援を求めてください。",
    "stop": "ここで質問を止めます。続けたいときに再開できます。"
  },
  "ko": {
    "language": "Korean",
    "safety": "안전을 우선하기 위해 지금의 안내를 잠시 멈출게요.",
    "urgentSafety": "현재 행동을 즉시 중단하고, 현재 있는 곳에서 응급 의료 도움을 받으세요.",
    "stop": "질문은 여기서 멈출게요. 원할 때 계속할 수 있어요."
  },
  "ru": {
    "language": "Russian",
    "safety": "Я приостановлю текущие рекомендации, чтобы поставить вашу безопасность на первое место.",
    "urgentSafety": "Немедленно прекратите текущее действие и обратитесь за экстренной медицинской помощью по месту нахождения.",
    "stop": "Я перестану задавать вопросы. Вы можете продолжить, когда захотите."
  }
} satisfies Record<M3Locale, { language: string; safety: string; urgentSafety: string; stop: string }>;
