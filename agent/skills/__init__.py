# The skills of the agent service (docs/02 §2.11.3 "Skills"): one YAML file each in this folder, read when the service
# starts. A file that is wrong stops the start, so a bad skill never reaches a user. Syncing them to `agentSkills`
# and ranking them for a question come with T46.
from dataclasses import dataclass, field
from pathlib import Path

import yaml

FOLDER = Path(__file__).parent
LANGUAGES = ('vi', 'en')


@dataclass(frozen=True)
class SkillTool:
    name: str
    ord: int
    preset: dict = field(default_factory=dict)  # fixed arguments: they win over anything the model says


@dataclass(frozen=True)
class Skill:
    code: str
    label_vi: str
    label_en: str
    description: str
    examples: list
    triggers: list
    mode: str  # pipeline: the tools run in order with no model; agent: the model picks tools
    tools: list
    followups: list  # 2-3 chips, each {vi, en}
    templates: dict  # {vi|en: {answer, sources}}
    max_steps: int = 4
    enabled: bool = True
    version: int = 1


def read_skill(path, registry):
    raw = yaml.safe_load(path.read_text(encoding='utf-8'))
    where = path.name
    if raw.get('code') != path.stem:
        raise ValueError(f'{where}: code must be the file name ({path.stem})')
    if raw.get('mode') not in ('pipeline', 'agent'):
        raise ValueError(f'{where}: mode must be pipeline or agent')
    tools = [SkillTool(t['name'], t['ord'], t.get('preset') or {}) for t in sorted(raw.get('tools') or [], key=lambda t: t['ord'])]
    for tool in tools:
        if tool.name not in registry.tools:
            raise ValueError(f'{where}: tool {tool.name} is not in the registry')
    if not 2 <= len(raw.get('followups') or []) <= 3 or any(not f.get(lang) for f in raw['followups'] for lang in LANGUAGES):
        raise ValueError(f'{where}: followups must be 2-3 chips with a vi and an en text')
    for lang in LANGUAGES:
        template = (raw.get('templates') or {}).get(lang) or {}
        if not template.get('answer') or not template.get('sources'):
            raise ValueError(f'{where}: templates.{lang} needs an answer and a sources line')
    for key in ('labelVi', 'labelEn', 'description', 'examples', 'triggers'):
        if not raw.get(key):
            raise ValueError(f'{where}: {key} is missing')
    return Skill(
        code=raw['code'], label_vi=raw['labelVi'], label_en=raw['labelEn'], description=raw['description'], examples=raw['examples'],
        triggers=raw['triggers'], mode=raw['mode'], tools=tools, followups=raw['followups'], templates=raw['templates'],
        max_steps=raw.get('maxSteps', 4), enabled=raw.get('enabled', True), version=raw.get('version', 1))


def load_skills(registry, folder=FOLDER):
    """{code: Skill} for every *.yaml in `folder`."""
    skills = (read_skill(path, registry) for path in sorted(folder.glob('*.yaml')))
    return {skill.code: skill for skill in skills}
