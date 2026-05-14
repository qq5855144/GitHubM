"""
AI 助手对话类型管理方案 — 基于 DeepSeek API 落地实现

核心原则：默认不执行，执行需显式授权
"""

import json
import os
from dataclasses import dataclass, field
from enum import Enum
from typing import Optional

from openai import OpenAI


# ============================================================================
# 1. 对话状态机
# ============================================================================

class DialogMode(Enum):
    """对话模式 - 状态机"""
    CHAT = "chat"           # 纯对话模式：只能回答，禁止工具调用
    PLANNING = "planning"   # 规划模式：可以讨论方案，但不能执行
    EXECUTING = "executing" # 执行模式：允许调用工具


class IntentType(Enum):
    """用户意图分类"""
    QUESTION = "question"       # 咨询/问答
    DISCUSS = "discuss"         # 协作讨论
    REQUEST_EXECUTE = "request_execute"  # 明确要求执行
    CLARIFY = "clarify"         # 确认/澄清
    MODE_SWITCH = "mode_switch" # 切换模式


@dataclass
class SessionState:
    """会话状态"""
    mode: DialogMode = field(default=DialogMode.CHAT)
    # 执行触发词库（用户必须使用其中一个，才能进入 EXECUTING 模式）
    execute_triggers: set = field(default_factory=lambda: {
        "生成", "创建", "开始", "执行", "修改", "更新", "部署", "提交",
        "generate", "create", "start", "execute", "modify", "update", "deploy", "commit"
    })
    # 模式切换词
    mode_switch_triggers: dict = field(default_factory=lambda: {
        "开始规划": DialogMode.PLANNING,
        "进入规划": DialogMode.PLANNING,
        "开始执行": DialogMode.EXECUTING,
        "进入执行": DialogMode.EXECUTING,
        "只聊天": DialogMode.CHAT,
        "保持对话": DialogMode.CHAT,
    })

    def can_execute(self) -> bool:
        return self.mode == DialogMode.EXECUTING

    def switch_mode(self, target: DialogMode) -> str:
        old = self.mode.value
        self.mode = target
        return f"🔄 模式切换：{old} → {target.value}"


# ============================================================================
# 2. 意图分类器
# ============================================================================

INTENT_CLASSIFICATION_PROMPT = """You are an intent classifier for an AI assistant.
Analyze the user's message and classify it into ONE of these categories:

- "question": User is asking for information, advice, or explanation. They do NOT want you to take any action.
- "discuss": User wants to brainstorm, discuss ideas, or collaborate on a plan. No execution yet.
- "request_execute": User explicitly asks you to DO something (write code, modify files, deploy, etc.).
- "clarify": User is asking for clarification about your previous response.
- "mode_switch": User wants to change the conversation mode (e.g., "let's plan", "start executing", "just chat").

Respond ONLY with a JSON object in this exact format:
{
  "intent": "<one of the categories above>",
  "confidence": <0.0 to 1.0>,
  "reasoning": "<brief explanation>",
  "safe_to_proceed": <true/false>
}

Rules:
1. Default to "question" if unsure. Better to be conservative.
2. "request_execute" requires explicit action words like "generate", "create", "write", "build", "deploy".
3. Phrases like "how to", "what if", "can you explain" are ALWAYS "question", never "request_execute".
4. "Let's discuss", "what do you think about" are "discuss".
5. "Start planning", "let's plan" are "mode_switch".
"""


class IntentClassifier:
    def __init__(self, client: OpenAI, model: str = "deepseek-chat"):
        self.client = client
        self.model = model

    def classify(self, user_message: str) -> dict:
        """对用户消息进行意图分类"""
        response = self.client.chat.completions.create(
            model=self.model,
            messages=[
                {"role": "system", "content": INTENT_CLASSIFICATION_PROMPT},
                {"role": "user", "content": user_message}
            ],
            temperature=0.0,  # 低温度确保一致性
            max_tokens=200
        )
        try:
            result = json.loads(response.choices[0].message.content)
            return result
        except json.JSONDecodeError:
            # 处理模型未按要求返回 JSON 的情况，默认保守
            return {
                "intent": "question",
                "confidence": 0.5,
                "reasoning": "Failed to parse classification, defaulting to safe mode",
                "safe_to_proceed": False
            }


# ============================================================================
# 3. 系统提示工程
# ============================================================================

SYSTEM_PROMPTS = {
    DialogMode.CHAT: """You are a helpful assistant in CHAT mode.

🚫 CRITICAL RULES:
- You can ONLY provide text responses. NEVER call any tools or functions.
- Do NOT write code, modify files, or execute commands unless explicitly authorized.
- If the user asks "how to do X", explain the approach. Do NOT implement it.
- If the user says "let's plan" or "start executing", inform them they need to switch modes first.

Current mode: CHAT
""",

    DialogMode.PLANNING: """You are a helpful assistant in PLANNING mode.

🚫 CRITICAL RULES:
- You can discuss, brainstorm, and create plans. Do NOT execute anything yet.
- You can write pseudocode or outline steps, but do NOT write actual implementation code.
- If the user wants to proceed with execution, they must say "start executing" or "开始执行".

Current mode: PLANNING
""",

    DialogMode.EXECUTING: """You are a helpful assistant in EXECUTING mode.

✅ You are authorized to:
- Write and modify code
- Call tools and functions
- Execute commands
- Deploy changes

🚫 Still prohibited:
- Deleting production data without confirmation
- Making irreversible changes without user approval

Current mode: EXECUTING
"""
}


# ============================================================================
# 4. 对话管理器（核心）
# ============================================================================

class DialogManager:
    """对话管理器 - 统一入口"""

    def __init__(self, api_key: Optional[str] = None, base_url: str = "https://api.deepseek.com"):
        self.client = OpenAI(
            api_key=api_key or os.getenv("DEEPSEEK_API_KEY"),
            base_url=base_url
        )
        self.classifier = IntentClassifier(self.client)
        self.state = SessionState()
        self.history: list[dict] = []  # 对话历史

    def _check_mode_switch(self, message: str) -> Optional[str]:
        """检查是否是模式切换请求"""
        for trigger, target_mode in self.state.mode_switch_triggers.items():
            if trigger in message:
                return self.state.switch_mode(target_mode)
        return None

    def _check_implicit_execute_request(self, message: str) -> bool:
        """检查是否含有隐式执行请求（触发词）"""
        return any(trigger in message for trigger in self.state.execute_triggers)

    def process(self, user_message: str) -> str:
        """
        处理用户消息，返回响应

        流程：
        1. 检查模式切换
        2. 意图分类
        3. 根据模式和意图决定是否执行
        4. 调用 LLM 生成响应
        """
        # Step 1: 检查模式切换
        mode_switch_result = self._check_mode_switch(user_message)
        if mode_switch_result:
            return mode_switch_result

        # Step 2: 意图分类
        classification = self.classifier.classify(user_message)
        intent = IntentType(classification.get("intent", "question"))
        confidence = classification.get("confidence", 0.0)
        safe = classification.get("safe_to_proceed", False)

        print(f"[Debug] Intent: {intent.value}, Confidence: {confidence}, Safe: {safe}")

        # Step 3: 权限校验
        if intent == IntentType.REQUEST_EXECUTE:
            if not self.state.can_execute():
                # 用户要求执行，但当前不在执行模式
                if self._check_implicit_execute_request(user_message):
                    return (
                        f"⚠️ 当前为 `{self.state.mode.value}` 模式，无法执行操作。\n\n"
                        f"检测到执行请求：含有触发词。\n"
                        f"如需执行，请说：\"开始执行\" 或 \"start executing\""
                    )
                else:
                    # 意图不够明确，按咨询处理
                    intent = IntentType.QUESTION

        # Step 4: 构建系统提示
        system_prompt = SYSTEM_PROMPTS[self.state.mode]

        # 如果是执行请求且在正确模式下，可以附加工具描述
        tools_description = ""
        if intent == IntentType.REQUEST_EXECUTE and self.state.can_execute():
            tools_description = """
你可以使用以下工具：
- file_write: 写入文件
- file_read: 读取文件
- command_run: 执行命令
"""

        # 构建完整的对话
        messages = [
            {"role": "system", "content": system_prompt + tools_description},
            *self.history,
            {"role": "user", "content": user_message}
        ]

        # 调用 DeepSeek
        response = self.client.chat.completions.create(
            model="deepseek-chat",
            messages=messages,
            temperature=0.7,
            # tools=可选：如果在执行模式下可以传入 tools 参数
        )

        assistant_reply = response.choices[0].message.content

        # 更新历史（可根据需要限制长度）
        self.history.append({"role": "user", "content": user_message})
        self.history.append({"role": "assistant", "content": assistant_reply})

        return assistant_reply


# ============================================================================
# 5. 使用示例
# ============================================================================

def demo():
    """演示如何使用"""
    manager = DialogManager()

    test_messages = [
        "你好，今天天气怎么样？",                           # 应该：咨询
        "我想做一个任务管理系统，怎么设计比较好？",         # 应该：咨询（只是问怎么设计）
        "开始规划",                                             # 应该：切换到 PLANNING
        "我们用 React + TypeScript 做，需要登录、任务 CRUD",    # 应该：讨论
        "开始执行",                                             # 应该：切换到 EXECUTING
        "帮我创建项目结构和基础代码",                          # 应该：执行（正确模式）
        "保持对话",                                             # 应该：切换回 CHAT
        "刚才的代码里那个函数是干什么的？",                  # 应该：咨询
    ]

    for msg in test_messages:
        print(f"\n{'='*60}")
        print(f"💬 用户: {msg}")
        print(f"🔄 当前模式: {manager.state.mode.value}")
        reply = manager.process(msg)
        print(f"🤖 AI: {reply}")
        print(f"📊 新模式: {manager.state.mode.value}")


if __name__ == "__main__":
    # 运行前请设置环境变量 DEEPSEEK_API_KEY
    demo()
