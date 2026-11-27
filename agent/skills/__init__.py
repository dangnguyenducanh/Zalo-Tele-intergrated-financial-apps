# The skills of the agent service (docs/02 §2.11.3 "Skills"): one YAML file each in this folder, read when the service
# starts. A file that is wrong stops the start, so a bad skill never reaches a user. sync.py copies them to `agentSkills`
# and routing.py ranks them for a question.
from dataclasses import dataclass, field
from pathlib import Path

import yaml

FOLDER = Path(__file__).parent
LANGUAGES = ('vi', 'en')
DEFAULT_PERIODS = ('month', 'week')
ENTITIES = ('category', 'wallet')


@dataclass(frozen=True)
class SkillTool:
    name: str
    ord: int
    preset: dict = field(default_factory=dict)  # fixed arguments: they win over anything the model says
    month_shift: int = 0  # months added to the month a tool is given: suggest_budgets in the monthly report looks at the month after the one reported


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
    pairs: list = field(default_factory=list)  # [{entity: category|wallet, phrases: [...]}]: a phrase plus a linked entity is decisive
    anchored: bool = False  # every trigger is a word of this skill alone ("ngân sách", "tổng kết tuần"): one found in the question picks the skill
    default_period: str = 'month'  # the period of a question that names none: month (this month, or the month the request asks for) or week (this week)


def read_skill(path, registry):
    raw = yaml.safe_load(path.read_text(encoding='utf-8'))
    where = path.name
    if raw.get('code') != path.stem:
        raise ValueError(f'{where}: code must be the file name ({path.stem})')
    if raw.get('mode') not in ('pipeline', 'agent'):
        raise ValueError(f'{where}: mode must be pipeline or agent')
    tools = [SkillTool(t['name'], t['ord'], t.get('preset') or {}, t.get('monthShift', 0)) for t in sorted(raw.get('tools') or [], key=lambda t: t['ord'])]
    for tool in tools:
        if type(tool.month_shift) is not int:
            raise ValueError(f'{where}: monthShift of {tool.name} must be a whole number')
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
    for pair in raw.get('pairs') or []:
        if pair.get('entity') not in ENTITIES or not pair.get('phrases'):
            raise ValueError(f'{where}: a pair needs an entity (category or wallet) and phrases')
    if not isinstance(raw.get('anchored', False), bool):
        raise ValueError(f'{where}: anchored must be true or false')
    if raw.get('defaultPeriod', 'month') not in DEFAULT_PERIODS:
        raise ValueError(f'{where}: defaultPeriod must be month or week')
    return Skill(
        code=raw['code'], label_vi=raw['labelVi'], label_en=raw['labelEn'], description=raw['description'], examples=raw['examples'],
        triggers=raw['triggers'], mode=raw['mode'], tools=tools, followups=raw['followups'], templates=raw['templates'],
        max_steps=raw.get('maxSteps', 4), enabled=raw.get('enabled', True), version=raw.get('version', 1), pairs=raw.get('pairs') or [],
        anchored=raw.get('anchored', False), default_period=raw.get('defaultPeriod', 'month'))


def load_skills(registry, folder=FOLDER):
    """{code: Skill} for every *.yaml in `folder`."""
    skills = (read_skill(path, registry) for path in sorted(folder.glob('*.yaml')))
    return {skill.code: skill for skill in skills}
