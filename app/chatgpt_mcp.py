"""ChatGPT/Codex MCP adapter for LawFlow.

The connected ChatGPT model performs reasoning and writing. This server only
provides scoped LawFlow project, source, workflow, and export operations.
"""
from __future__ import annotations

from typing import Any

from mcp.server.fastmcp import FastMCP


def create_lawflow_mcp(lawflow: Any) -> FastMCP:
    server = FastMCP(
        "LawFlow",
        instructions=(
            "Use LawFlow to organize legal content work. Before writing, read the project context and stay within the returned source blocks. "
            "For public-facing training, speaking notes, and podcasts, complete or close verification tasks before saving a draft. "
            "Do not treat a draft as a formal legal opinion."
        ),
        stateless_http=True,
        json_response=True,
        streamable_http_path="/",
    )

    @server.tool(name="list_lawflow_projects", description="List LawFlow content projects and their scenario, source count, and verification task count.")
    def list_lawflow_projects() -> list[dict]:
        return lawflow.list_projects()

    @server.tool(name="get_lawflow_project", description="Get one project, including materials, chapter plans, verification tasks, drafts, and audio outputs.")
    def get_lawflow_project(project_id: str) -> dict:
        return lawflow.get_project(project_id)

    @server.tool(name="create_lawflow_project", description="Create a LawFlow task. Choose daily_brief, topic_learning, speaking_note, or legal_podcast.")
    def create_lawflow_project(name: str, scenario: str = "topic_learning", description: str = "") -> dict:
        config = lawflow.CONTENT_SCENARIOS.get(scenario)
        if config is None:
            raise ValueError("scenario must be daily_brief, topic_learning, speaking_note, or legal_podcast")
        payload = lawflow.ProjectCreate(
            name=name,
            description=description,
            scenario=scenario,
            transform_mode=config["transform_mode"],
            verification_mode=config["verification_mode"],
            target_duration=config["target_duration"],
            audio_enabled=config["audio_enabled"],
        )
        return lawflow.create_project(payload)

    @server.tool(name="add_lawflow_text_source", description="Add pasted public news, a judgment summary, or a practice note to one LawFlow project.")
    def add_lawflow_text_source(project_id: str, title: str, content: str, source_url: str = "") -> dict:
        return lawflow.create_text_source(project_id, lawflow.TextSourceCreate(title=title, content=content, source_url=source_url))

    @server.tool(name="get_lawflow_source_context", description="Read the controlled blocks for one LawFlow source before drafting. Use only these blocks for factual statements.")
    def get_lawflow_source_context(project_id: str, document_id: str = "", limit: int = 80) -> dict:
        return lawflow.get_skill_project_context(project_id, document_id=document_id, limit=limit)

    @server.tool(name="create_lawflow_structure", description="Create a source-grounded structure for a selected LawFlow document. The user should review and confirm it before writing.")
    def create_lawflow_structure(project_id: str, document_id: str, audience: str = "法律从业者", style_name: str = "专业、自然、结论先行") -> dict:
        return lawflow.create_plan(project_id, lawflow.PlanCreate(source_document_id=document_id, audience=audience, style_name=style_name))

    @server.tool(name="confirm_lawflow_structure", description="Confirm a reviewed LawFlow structure. For non-learning scenarios this creates verification tasks before public-facing drafting.")
    def confirm_lawflow_structure(plan_id: str, chapters: list[dict]) -> dict:
        return lawflow.confirm_plan(plan_id, lawflow.PlanConfirm(chapters=chapters))

    @server.tool(name="update_lawflow_verification_task", description="Update an existing verification task after the user confirms its status, owner, and due date.")
    def update_lawflow_verification_task(task_id: str, status: str, owner: str = "", due_date: str = "") -> dict:
        return lawflow.update_task(task_id, lawflow.TaskUpdate(status=status, owner=owner, due_date=due_date))

    @server.tool(name="save_lawflow_chatgpt_draft", description="Save a ChatGPT-written, source-grounded Markdown draft into LawFlow for review and export. Pass every source block actually used.")
    def save_lawflow_chatgpt_draft(project_id: str, document_id: str, title: str, markdown: str, source_block_ids: list[str], style_profile: str = "law_podcast_v4") -> dict:
        return lawflow.create_skill_host_content(
            project_id,
            lawflow.SkillHostContentRequest(
                document_id=document_id,
                title=title,
                markdown=markdown,
                source_block_ids=source_block_ids,
                style_profile=style_profile,
                review_note="由已连接的 ChatGPT 生成，待人工审阅。",
            ),
        )

    @server.tool(name="create_lawflow_audio_script", description="Create an editable audio script from an existing LawFlow draft. This does not publish or generate a final MP3.")
    def create_lawflow_audio_script(project_id: str, narrative_content_id: str) -> dict:
        return lawflow.create_audio_script(project_id, lawflow.AudioScriptRequest(narrative_content_id=narrative_content_id))

    @server.tool(name="list_lawflow_daily_briefs", description="List daily legal-news RSS subscriptions and their latest run status.")
    def list_lawflow_daily_briefs() -> list[dict]:
        return lawflow.list_daily_brief_subscriptions()

    @server.tool(name="create_lawflow_daily_brief", description="Create a daily RSS or Atom legal-news subscription. It collects sources into reviewable LawFlow tasks and never auto-publishes.")
    def create_lawflow_daily_brief(name: str, feed_url: str, daily_time: str = "08:00", max_items: int = 3) -> dict:
        return lawflow.create_daily_brief_subscription(
            lawflow.DailyBriefSubscriptionCreate(name=name, feed_url=feed_url, daily_time=daily_time, max_items=max_items),
        )

    @server.tool(name="run_lawflow_daily_brief_now", description="Fetch new items from one daily legal-news subscription now and create a reviewable LawFlow task.")
    def run_lawflow_daily_brief_now(subscription_id: str) -> dict:
        return lawflow.run_daily_brief_subscription(subscription_id)

    @server.tool(name="export_lawflow_project", description="Export a LawFlow project to the configured local output directory after the user has reviewed its content.")
    def export_lawflow_project(project_id: str) -> dict:
        return lawflow.export_project(project_id)

    return server
