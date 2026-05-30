import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

// 翻译资源
const resources = {
  en: {
    translation: {
      login: {
        title: "GitHub Manager",
        subtitle: "Log in securely via GitHub Personal Access Token",
        tokenLabel: "Personal Access Token",
        placeholder: "ghp_xxxxxxxxxxxxxxxxxxxx",
        button: "Sign in",
        loading: "Verifying...",
        errorEmpty: "Please enter GitHub Token",
        success: "Login successful! Welcome to GitHub Manager",
        errInvalid: "Token is invalid or expired. Please regenerate and try again.",
        errPerm: "Insufficient token permissions. Make sure it has 'repo', 'user', 'notifications' scopes.",
        errFetch: "Failed to fetch user info. Please ensure token is valid.",
        errNetwork: "Network connection failed. Please check your network and try again.",
        errFail: "Login failed: {{message}}",
        hintInvalid: "Please go to GitHub -> Settings -> Developer settings -> Personal access tokens to regenerate.",
        hintPerm: "When generating Token, please check: repo, user, notifications",
        howToTitle: "How to get a Personal Access Token?",
        howTo1: "Log into GitHub, go to Settings -> Developer Settings",
        howTo2: "Select Personal access tokens -> Tokens (classic)",
        howTo3: "Click Generate new token",
        howTo4: "Select required scopes: repo, notifications, user",
        howTo5: "Generate and copy the token",
        link: "Go to GitHub to create token",
        security: "Token is only stored locally in the browser and will never be uploaded to any server."
      },
      settings: {
        title: "Settings",
        accountInfo: "Account Info",
        editProfile: "Edit Profile",
        verified: "Verified",
        email: "Email",
        company: "Company",
        location: "Location",
        website: "Website",
        publicRepos: "Public Repos",
        viewGithub: "View on GitHub",
        preferences: "Preferences",
        language: "Language",
        langZh: "简体中文",
        langEn: "English",
        appearance: "Appearance",
        theme: "Theme",
        themeLight: "Light",
        themeDark: "Dark",
        themeSystem: "System",
        themeDescSystem: "Currently following system preference",
        themeDescDark: "Currently using dark theme",
        themeDescLight: "Currently using light theme",
        accentScheme: "Accent Color",
        accountToken: "Account & Token",
        aiConfig: "AI Configuration",
        visitStats: "Visit Statistics",
        about: "About",
        version: "Version",
        author: "Developer"
      }
    }
  },
  'zh-CN': {
    translation: {
      login: {
        title: "GitHub 管理器",
        subtitle: "通过 GitHub Personal Access Token 安全登录",
        tokenLabel: "Personal Access Token",
        placeholder: "ghp_xxxxxxxxxxxxxxxxxxxx",
        button: "登录",
        loading: "验证中...",
        errorEmpty: "请输入 GitHub 令牌",
        success: "登录成功！欢迎使用 GitHub 管理器",
        errInvalid: "令牌无效或已过期，请重新生成后重试",
        errPerm: "令牌权限不足，请确保令牌包含 repo、user、notifications 权限",
        errFetch: "无法获取用户信息，请确认令牌有效",
        errNetwork: "网络连接失败，请检查网络后重试",
        errFail: "登录失败：{{message}}",
        hintInvalid: "请前往 GitHub → Settings → Developer settings → Personal access tokens 重新生成",
        hintPerm: "生成 Token 时请勾选：repo、user、notifications",
        howToTitle: "如何获取 Personal Access Token？",
        howTo1: "登录 GitHub，进入 Settings → Developer Settings",
        howTo2: "选择 Personal access tokens → Tokens (classic)",
        howTo3: "点击 Generate new token",
        howTo4: "选择所需权限：repo、notifications、user",
        howTo5: "生成并复制令牌",
        link: "前往 GitHub 创建令牌",
        security: "令牌仅保存在本地浏览器中，不会上传至任何服务器"
      },
      settings: {
        title: "设置",
        accountInfo: "账号信息",
        editProfile: "编辑资料",
        verified: "已认证",
        email: "邮箱",
        company: "公司",
        location: "地区",
        website: "网站",
        publicRepos: "个公开仓库",
        viewGithub: "查看 GitHub 主页",
        preferences: "偏好设置",
        language: "语言",
        langZh: "简体中文",
        langEn: "English",
        appearance: "外观",
        theme: "外观主题",
        themeLight: "浅色",
        themeDark: "深色",
        themeSystem: "跟随系统",
        themeDescSystem: "当前跟随系统偏好自动切换主题",
        themeDescDark: "当前使用深色主题",
        themeDescLight: "当前使用浅色主题",
        accentScheme: "强调色方案",
        accountToken: "账户与令牌",
        aiConfig: "AI 配置",
        visitStats: "访问统计",
        about: "关于应用",
        version: "版本号",
        author: "开发者"
      }
    }
  }
};

const savedLang = localStorage.getItem('app_language') || 'zh-CN';

i18n
  .use(initReactI18next)
  .init({
    resources,
    lng: savedLang,
    fallbackLng: 'zh-CN',
    interpolation: {
      escapeValue: false // react already safes from xss
    }
  });

export default i18n;
