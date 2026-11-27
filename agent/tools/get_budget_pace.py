# get_budget_pace(month, categoryIds?): what is left to spend each day and where the month is heading, for each budget (docs/02 §2.11.2 A2). The rule is
# pace() in server/src/services/budgets.js (the Budgets chip, /dubao, /month and the confirm warning); both are tested on shared/fixtures/pace.json.
from calendar import monthrange

from pydantic import BaseModel, ConfigDict, Field

from ..money import money
from .budgets import budget_rows
from .scope import MonthText, ObjectIdText

PACE_FROM_DAY = 5  # a straight-line projection from fewer days overstates early-month spending such as rent
MONTHS_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
LABELS = {'vi': 'Dự báo', 'en': 'Forecast'}


def pace(spent, limit, day, days_in_month):
    """For a budget `spent` of `limit` on day `day` of a month of `days_in_month` days (today counts as a day left), in whole dong: None before day 5, else
    daysLeft (today included), perDay (the most to spend each of them; None once the limit is reached, never negative), projectedEnd (spent / day x days,
    rounded half up) and overDay (the first day the straight-line projection is over the limit; None when it never is this month). Integers only, no float."""
    if day < PACE_FROM_DAY:
        return None
    days_left = days_in_month - day + 1
    per_day = None if spent >= limit else (limit - spent) // days_left
    projected_end = (2 * spent * days_in_month + day) // (2 * day)
    over_day = None
    if 0 < spent < limit:
        first = limit * day // spent + 1
        over_day = first if first <= days_in_month else None
    return {'daysLeft': days_left, 'perDay': per_day, 'projectedEnd': projected_end, 'overDay': over_day}


class Args(BaseModel):
    model_config = ConfigDict(extra='forbid')
    month: MonthText  # 'YYYY-MM': only the current Vietnam month has a pace
    categoryIds: list[ObjectIdText] = Field(default_factory=list, max_length=20)


def sentence(row, month_number, language):
    """"còn 900.000 ₫ cho 6 ngày → tối đa 150.000 ₫/ngày; theo nhịp này cuối tháng ≈ 8.520.000 ₫, vượt khoảng 29/11" (the words of /dubao)."""
    found = row['pace']
    end = money(found['projectedEnd'], language)
    if language == 'vi':
        head = (f"còn {money(row['limit'] - row['spent'], language)} cho {found['daysLeft']} ngày → tối đa {money(found['perDay'], language)}/ngày" if found['perDay'] is not None
                else 'đã vượt ngân sách')
        over = f", vượt khoảng {found['overDay']:02d}/{month_number:02d}" if found['overDay'] else ''
        return f'{head}; theo nhịp này cuối tháng ≈ {end}{over}'
    head = (f"{money(row['limit'] - row['spent'], language)} left for {found['daysLeft']} {'day' if found['daysLeft'] == 1 else 'days'} → at most "
            f"{money(found['perDay'], language)} a day" if found['perDay'] is not None else 'over budget')
    over = f", over around {MONTHS_EN[month_number - 1]} {found['overDay']}" if found['overDay'] else ''
    return f'{head}; at this pace the month ends at about {end}{over}'


def handle(ctx, args):
    rows, _ = budget_rows(ctx, args.month, args.categoryIds)
    year, number = int(args.month[:4]), int(args.month[5:])
    current = args.month == f'{ctx.today:%Y-%m}'  # a past or a coming month has no "today"
    for row in rows:
        row['pace'] = pace(row['spent'], row['limit'], ctx.today.day, monthrange(year, number)[1]) if current else None
    facts = [{'id': 'overall' if row['categoryId'] is None else str(row['categoryId']), 'label': f"{LABELS.get(ctx.language, LABELS['vi'])} · {row['name']}",
              'display': sentence(row, number, ctx.language)} for row in rows if row['pace']]
    data = [{'categoryId': None if row['categoryId'] is None else str(row['categoryId']), **{key: row[key] for key in ('name', 'limit', 'spent', 'pace')}} for row in rows]
    return {'month': args.month, 'budgets': data}, facts
