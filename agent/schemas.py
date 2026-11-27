# The body of POST /v1/turn (docs/02 §2.11.3 contract, docs/04 §4.11 "Agent service API"). A bad body is 422.
import re
from datetime import date
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

OBJECT_ID = re.compile(r'[0-9a-f]{24}')


class TurnRequest(BaseModel):
    model_config = ConfigDict(extra='forbid')
    trigger: Literal['chat', 'confirm', 'schedule', 'event']
    userId: str
    channel: Literal['web', 'telegram', 'zalo', 'whatsapp']
    threadKey: str = Field(min_length=1, max_length=128)
    requestId: str = Field(min_length=1, max_length=256)  # a chat reference or the drawer's id: any text, only unique per user
    text: str | None = Field(default=None, max_length=20000)  # ingress answers a text over 500 itself; this only stops absurd bodies
    actionId: str | None = None
    skill: str | None = Field(default=None, max_length=64)
    language: Literal['vi', 'en']
    today: date  # the Vietnam date
    month: str | None = Field(default=None, pattern=r'^[0-9]{4}-(0[1-9]|1[0-2])$')  # the period when the question names none
    allowLlm: bool = False

    @field_validator('userId', 'actionId')
    @classmethod
    def object_id(cls, value):
        if value is not None and not OBJECT_ID.fullmatch(value):
            raise ValueError('not an ObjectId')
        return value
