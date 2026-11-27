# get_budgets(month, categoryIds?): each budget of a month with what is spent and what is left (docs/02 §2.11.3). Read-only; the user's own budgets,
# the user's confirmed expenses, and the user's own categories only.
from pydantic import BaseModel, ConfigDict, Field

from ..money import money
from .budgets import budget_rows
from .scope import MonthText, ObjectIdText

TEXT = {
    'vi': {'budget': 'Ngân sách', 'none': 'chưa đặt ngân sách cho tháng này'},
    'en': {'budget': 'Budget', 'none': 'no budget set for this month'},
}


class Args(BaseModel):
    model_config = ConfigDict(extra='forbid')
    month: MonthText  # 'YYYY-MM' in Vietnam time
    categoryIds: list[ObjectIdText] = Field(default_factory=list, max_length=20)  # none: every budget of the month


def status(row, language):
    """"còn 35.000 ₫ (đã chi 215.000 ₫ / 250.000 ₫, 86%)", "hết ngân sách (…)" or "vượt 35.000 ₫ (…)"."""
    left = row['limit'] - row['spent']
    spent, limit = money(row['spent'], language), money(row['limit'], language)
    if language == 'vi':
        head = f'còn {money(left, language)}' if left > 0 else 'hết ngân sách' if left == 0 else f'vượt {money(-left, language)}'
        return f"{head} (đã chi {spent} / {limit}, {row['percent']}%)"
    head = f'{money(left, language)} left' if left > 0 else 'none left' if left == 0 else f'over by {money(-left, language)}'
    return f"{head} (spent {spent} of {limit}, {row['percent']}%)"


def handle(ctx, args):
    rows, asked = budget_rows(ctx, args.month, args.categoryIds)
    text = TEXT.get(ctx.language, TEXT['vi'])
    facts = [{'id': 'overall' if row['categoryId'] is None else str(row['categoryId']), 'label': f"{text['budget']} · {row['name']}", 'display': status(row, ctx.language)}
             for row in rows]
    have = {row['categoryId'] for row in rows}
    facts += [{'id': str(cid), 'label': f"{text['budget']} · {name}", 'display': text['none']} for cid, name in asked.items() if cid not in have]  # asked for, none set
    if not facts:
        facts = [{'id': 'none', 'label': text['budget'], 'display': text['none']}]
    data = [{'categoryId': None if row['categoryId'] is None else str(row['categoryId']), **{key: row[key] for key in ('name', 'limit', 'spent', 'percent')}} for row in rows]
    return {'month': args.month, 'budgets': data}, facts
