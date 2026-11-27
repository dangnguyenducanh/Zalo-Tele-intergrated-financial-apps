# The fixed lines of a reply that no skill owns (docs/02 §2.11.3 "generate_answer": templates for no data, failures and
# the help text), in both languages, and how a period is named in a reply.
MAX_TEXT = 500

COMMANDS = {
    'vi': 'Lệnh: /today (hôm nay), /month (tháng này), /hoi (câu hỏi), /lang vi|en, /help',
    'en': 'Commands: /today, /month, /hoi (a question), /lang vi|en, /help',
}
SOURCE = {'vi': 'Nguồn', 'en': 'Source'}


def help_text(examples, language):
    """What the assistant can answer: up to 3 example questions, one from each of the first enabled pipeline skills, then
    the plain commands."""
    head = ('Mình trả lời được các câu hỏi về thu chi của bạn, ví dụ:' if language == 'vi'
            else 'I can answer questions about your income and spending, for example:')
    return '\n'.join([head, *(f'- {example}' for example in examples[:3]), COMMANDS[language]])


def cap_line(cap, language):
    line = (f'Bạn đã dùng hết {cap} câu hỏi hôm nay trên kênh này, mai hỏi tiếp nhé. Các lệnh thường vẫn dùng được.'
            if language == 'vi' else f'You have used all {cap} questions for today on this channel; ask again tomorrow. The plain commands still work.')
    return f'{line}\n{COMMANDS[language]}'


def too_long(language):
    return (f'Câu hỏi dài quá {MAX_TEXT} ký tự, bạn hỏi ngắn hơn nhé.' if language == 'vi'
            else f'That question is longer than {MAX_TEXT} characters; please ask it shorter.')


def failed(language):
    return ('Mình chưa lấy được số liệu lúc này, bạn thử lại sau nhé.' if language == 'vi'
            else 'I could not read your figures just now; please try again later.')


def done(summary, language):
    if not summary:
        return 'Đã xong.' if language == 'vi' else 'Done.'
    return f'Đã xong: {summary}' if language == 'vi' else f'Done: {summary}'


def expired(language):
    return ('Thao tác này đã hết hạn hoặc không còn hiệu lực.' if language == 'vi'
            else 'This action has expired or is no longer valid.')


MONTHS_EN = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
NAMES = {  # a Period's name (period.py) in a reply: (Vietnamese, English)
    'today': ('hôm nay', 'today'), 'yesterday': ('hôm qua', 'yesterday'),
    'this_week': ('tuần này', 'this week'), 'last_week': ('tuần trước', 'last week'), 'weekend': ('cuối tuần', 'the weekend'),
    'this_month': ('tháng này', 'this month'), 'last_month': ('tháng trước', 'last month'),
}


def span(period):
    """The days a reply covers, the way a source line shows them: 25/11/2026, 11/2026, 2026 or 19/11/2026–25/11/2026."""
    if period.start == period.end:
        return f'{period.start:%d/%m/%Y}'
    if period.unit == 'month':
        return f'{period.start:%m/%Y}'
    if period.unit == 'year':
        return f'{period.start:%Y}'
    return f'{period.start:%d/%m/%Y}–{period.end:%d/%m/%Y}'


def describe(period, language):
    """The period named as the question did, with its days: "tháng này (11/2026)", "tuần trước (16/11/2026–22/11/2026)"."""
    index = 0 if language == 'vi' else 1
    if period.name in NAMES:
        return f'{NAMES[period.name][index]} ({span(period)})'
    if period.name == 'month':
        return (f'tháng {period.start.month}/{period.start.year}' if language == 'vi'
                else f'{MONTHS_EN[period.start.month - 1]} {period.start.year}')
    if period.name == 'year':
        return f'năm {period.start.year}' if language == 'vi' else f'the year {period.start.year}'
    if period.name == 'days':
        days = (period.end - period.start).days + 1
        return f'{days} ngày qua ({span(period)})' if language == 'vi' else f'the last {days} days ({span(period)})'
    return f'ngày {span(period)}' if language == 'vi' else f'on {span(period)}'  # a date


# ---- ask-back and skipped conditions (T46) ----

def ask_which(language):
    return 'Bạn muốn hỏi ý nào?' if language == 'vi' else 'Which one do you mean?'


def ask_back(question, options, language):
    """The numbered list an ask-back shows (and Zalo's user answers by typing a number): the question, the options, how to reply."""
    reply = (f'Trả lời 1-{len(options)} trong 10 phút.' if language == 'vi' else f'Reply 1-{len(options)} within 10 minutes.')
    return '\n'.join([question, *(f"{option['n']}. {option['label']}" for option in options), reply])


def ask_back_expired(language):
    return 'Câu hỏi đã hết hạn, hãy hỏi lại' if language == 'vi' else 'That question has expired, please ask it again'


def ask_back_gone(language):
    return ('Lựa chọn này không còn dùng được nữa (danh mục, ví hoặc kỹ năng đã đổi), bạn hỏi lại nhé.' if language == 'vi'
            else 'That choice no longer works (a category, wallet or skill has changed), please ask again.')


KIND = {'category': ('danh mục', 'category'), 'wallet': ('ví', 'wallet')}


def entity_label(entity, language):
    """"danh mục Ăn uống", "ví MoMo"."""
    return f"{KIND[entity['kind']][0 if language == 'vi' else 1]} {entity['name']}"


def skipped(items, language):
    """The conditions of the question that the skill could not use, said out loud instead of dropped (docs/02 §2.11.3)."""
    return f"{'Bỏ qua điều kiện' if language == 'vi' else 'Skipped conditions'}: {'; '.join(items)}"


def capped_count(count, cap, language):
    """"50 khoản (chỉ hiển thị tối đa 20)": the N of a "top N" that is more than a tool gives."""
    return f'{count} khoản (chỉ hiển thị tối đa {cap})' if language == 'vi' else f'{count} items (showing at most {cap})'


def tie_label(entities, language):
    """Words that name more than one row: "danh mục Momo / ví Momo (trùng tên, không đoán)"."""
    names = ' / '.join(entity_label(entity, language) for entity in entities)
    return f'{names} ({"trùng tên, không đoán" if language == "vi" else "same name, not guessing"})'
