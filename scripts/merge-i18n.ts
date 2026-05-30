import * as fs from "fs";

const extracted = JSON.parse(fs.readFileSync("/workspace/app-bo4w33bsdqm9/extracted-zh.json", "utf-8"));

// Define a basic English dictionary for common terms in the app
const enDict: Record<string, string> = {
  "AI 助手": "AI Assistant",
  "设置": "Settings",
  "数据导出": "Export Data",
  "账号管理": "Account Mgmt",
  "活动": "Activity",
  "搜索": "Search",
  "通知": "Notifications",
  "仓库详情": "Repo Details",
  "仓库列表": "Repositories",
  "首页": "Dashboard",
  "登录": "Sign In",
  "退出登录": "Sign Out",
  "取消": "Cancel",
  "确定": "Confirm",
  "保存": "Save",
  "删除": "Delete",
  "编辑": "Edit",
  "创建": "Create",
  "查看": "View",
  "加载中...": "Loading...",
  "无数据": "No data",
  "暂无数据": "No data",
  "我的收藏": "Starred",
  "关注列表": "Following",
  "提交历史": "Commits",
  "代码浏览": "Code",
  "分支管理": "Branches",
  "协作者": "Collaborators",
  "仓库产物": "Artifacts",
  "批量上传": "Upload",
  "警告": "Warning",
  "成功": "Success",
  "错误": "Error",
  "确认": "Confirm",
  "关闭": "Close",
  "代码浏览根": "Code Root",
  "网络已断开，请检查网络连接": "Network disconnected, please check connection",
  "网络已恢复": "Network restored",
  "提交": "Commit",
  "更新": "Update",
  "添加": "Add",
  "移除": "Remove",
  "清除": "Clear",
  "重置": "Reset",
  "刷新": "Refresh",
  "复制": "Copy",
  "已复制": "Copied",
  "下载": "Download",
  "上传": "Upload",
  "返回": "Back",
  "下一步": "Next",
  "上一步": "Previous",
  "完成": "Done",
  "提示": "Hint",
  "状态": "Status",
  "描述": "Description",
  "名称": "Name",
  "标题": "Title",
  "语言": "Language",
  "版本": "Version",
  "时间": "Time",
  "作者": "Author",
  "大小": "Size",
  "操作": "Actions",
  "详情": "Details",
  "全部": "All",
  "更多": "More"
};

// Also apply some basic heuristics
const allEn: Record<string, string> = {};
for (const key of Object.keys(extracted)) {
  if (enDict[key]) {
    allEn[key] = enDict[key];
  } else {
    // default to key itself (so it shows Chinese, or we can try to leave it out)
    allEn[key] = key;
  }
}

let i18nCode = fs.readFileSync("/workspace/app-bo4w33bsdqm9/src/i18n.ts", "utf-8");

// Insert allEn into en.translation
const translationObjStr = JSON.stringify(allEn, null, 2);
// Replace `translation: {` with `translation: { ...allEn,`
const newI18nCode = i18nCode.replace("translation: {", `translation: {\n...${translationObjStr},\n`);

fs.writeFileSync("/workspace/app-bo4w33bsdqm9/src/i18n.ts", newI18nCode);
console.log("Merged translations into src/i18n.ts");
