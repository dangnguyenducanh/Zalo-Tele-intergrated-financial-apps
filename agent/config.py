# What the service reads from its environment (agent/.env on the GPU host, docs/06 §6.13).
import os
from dataclasses import dataclass, field

from pymongo.uri_parser import parse_uri


class ConfigError(Exception):
    """The service must not start. The message names variables, never their values."""


@dataclass(frozen=True)
class Settings:
    agent_secret: str = field(repr=False)  # repr=False: a settings object that lands in a log shows no secret
    mongodb_uri_agent: str = field(repr=False)
    llm_model: str = 'qwen3.5-2b'  # vLLM's served name; /health reports it
    embed_model: str = 'BAAI/bge-m3'  # must have a revision in models.lock

    @classmethod
    def from_env(cls, env=os.environ):
        missing = [name for name in ('AGENT_SECRET', 'MONGODB_URI_AGENT') if not env.get(name, '').strip()]
        if missing:
            raise ConfigError(f'{" and ".join(missing)} must be set in agent/.env: the service never runs open')
        try:
            parse_uri(env['MONGODB_URI_AGENT'])
        except Exception:  # not chained and not echoed: the string holds the user's password
            raise ConfigError('MONGODB_URI_AGENT is not a MongoDB connection string') from None
        return cls(
            agent_secret=env['AGENT_SECRET'],
            mongodb_uri_agent=env['MONGODB_URI_AGENT'],
            llm_model=env.get('LLM_MODEL') or cls.llm_model,
            embed_model=env.get('EMBED_MODEL') or cls.embed_model,
        )
