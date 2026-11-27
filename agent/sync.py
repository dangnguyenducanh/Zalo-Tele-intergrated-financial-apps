# What the service does when it starts (docs/02 §2.11.4 "Embedding space", docs/03 §3.7 `agentSkills`, `agentTools`):
# copy the skill files and the tool registry into MongoDB and embed what is new. A row's text is hashed (SHA-256) and the
# row is embedded again only when its hash is not the stored one, so a second start embeds nothing. The skills' vectors
# are then kept in memory (a few dozen rows: docs/01 §1.9), which is where find_skills searches them.
import hashlib
import logging
import time

from .tools.registry import FORBIDDEN_ARGS
from .tools.scope import MAX_TIME_MS

log = logging.getLogger('uvicorn.error')


def skill_text(skill):
    """What a skill's embedding is made of: its names, description, examples and triggers."""
    return '\n'.join([skill.label_vi, skill.label_en, skill.description, *skill.examples, *skill.triggers])


def skill_fields(skill):
    return {'labelVi': skill.label_vi, 'labelEn': skill.label_en, 'description': skill.description, 'examples': skill.examples,
            'triggers': skill.triggers, 'mode': skill.mode, 'schedule': None, 'followups': skill.followups, 'maxSteps': skill.max_steps,
            'tools': [{'name': tool.name, 'ord': tool.ord, 'preset': tool.preset} for tool in skill.tools], 'pairs': skill.pairs,
            'enabled': skill.enabled, 'version': skill.version}


def tool_fields(tool):
    schema = tool.args.model_json_schema()
    schema['properties'] = {key: value for key, value in schema.get('properties', {}).items() if key not in FORBIDDEN_ARGS}
    return {'description': tool.description, 'parameters': schema, 'sideEffect': tool.side_effect, 'timeoutMs': tool.timeout_ms,
            'collections': list(tool.collections), 'enabled': True, 'version': 1}


def store(db, collection, key, rows, embedder, scope=None):
    """Write every row ({name: (fields, text)}) and embed those whose text changed. Returns ({name: vector}, how many were
    embedded). A row that is no longer wanted stays, switched off: the files and the registry are the truth."""
    scope = scope or {}
    have = {row[key]: row for row in db[collection].find({**scope}, {key: 1, 'embedHash': 1, 'embedding': 1}, max_time_ms=MAX_TIME_MS)}
    hashes = {name: hashlib.sha256(text.encode()).hexdigest() for name, (_, text) in rows.items()}
    stale = [name for name in rows if have.get(name, {}).get('embedHash') != hashes[name]]
    fresh = dict(zip(stale, embedder.encode([rows[name][1] for name in stale]) if stale else []))
    for name, (fields, _) in rows.items():
        change = fields | ({'embedding': fresh[name], 'embedHash': hashes[name]} if name in fresh else {})
        db[collection].update_one({key: name, **scope}, {'$set': change}, upsert=True)
    db[collection].update_many({key: {'$nin': list(rows)}, **scope}, {'$set': {'enabled': False}})
    return {name: fresh.get(name) or have[name]['embedding'] for name in rows}, len(stale)


def sync(deps):
    """Run once when the service starts. Fills deps.vectors; a database or an embedder that fails stops the start."""
    started = time.perf_counter()
    skills = {code: (skill_fields(skill), skill_text(skill)) for code, skill in deps.skills.items()}
    tools = {name: (tool_fields(tool), f'{name}: {tool.description}') for name, tool in deps.registry.tools.items()}
    deps.vectors, skills_embedded = store(deps.db, 'agentSkills', 'code', skills, deps.embedder, {'userId': None})
    _, tools_embedded = store(deps.db, 'agentTools', 'name', tools, deps.embedder)
    log.info('request=start node=sync ms=%d', (time.perf_counter() - started) * 1000)
    return {'skills': skills_embedded, 'tools': tools_embedded}
