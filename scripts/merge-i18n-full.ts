import * as fs from "fs";

const translated = JSON.parse(fs.readFileSync("/workspace/app-bo4w33bsdqm9/translated-en.json", "utf-8"));

let i18nCode = fs.readFileSync("/workspace/app-bo4w33bsdqm9/src/i18n.ts", "utf-8");

// We need to replace the `translation: { ... }` block inside `en: {`
// Let's use string manipulation carefully.

// It looks like currently in i18n.ts:
//  en: {
//    translation: {
//      ...
//      login: { ... },
//      settings: { ... }
//    }
//  }

// We will recreate the translation object string, keeping login and settings, and adding all `translated` keys.

const oldI18nStr = i18nCode.match(/translation:\s*\{([\s\S]*?)(login:\s*\{[\s\S]*?\},[\s\S]*?settings:\s*\{[\s\S]*?\})\s*\}/)?.[2];
if (!oldI18nStr) {
  console.log("Could not find translation block properly. Using basic replace.");
}

// Just parse the file or just inject correctly.
// Let's build a new translation obj string:
const newTranslationEntries = Object.entries(translated)
  .map(([k, v]) => `      ${JSON.stringify(k)}: ${JSON.stringify(v)}`)
  .join(",\n");

// Regex to replace all entries before "login: {" in the translation object.
// Wait, the safest way is to just replace the whole en.translation block. We can just keep login and settings as static code here.

const replacement = `    translation: {
${newTranslationEntries},
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
        linkShort: "Get Token"
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
        themeDescSystem: "Automatically switch theme based on system preferences",
        themeDescDark: "Currently using dark theme",
        themeDescLight: "Currently using light theme",
        accentScheme: "Accent Color",
        accountToken: "Account & Token",
        aiConfig: "AI Configuration",
        visitStats: "Visit Statistics",
        about: "About App",
        version: "Version",
        author: "Developer"
      }
    }`;

// use regex to replace from `translation: {` to the matching closing brace.
// since doing nested brace matching in regex is hard, we can just split/join.

const parts = i18nCode.split(/translation:\s*\{/);
const secondPart = parts[1];
const braceParts = secondPart.split(/    \}\n  \},\n  'zh-CN': \{/);

const finalCode = parts[0] + replacement + "\n  },\n  'zh-CN': {" + braceParts[1];
fs.writeFileSync("/workspace/app-bo4w33bsdqm9/src/i18n.ts", finalCode);
console.log("Written full translation to i18n.ts");
