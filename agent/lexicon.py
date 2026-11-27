# Linking words to the user's own categories and wallets (docs/02 §2.11.3 `rewrite_question`, docs/07 §7.9.2 *lexicon
# linking*). The lexicon is built per turn from the rows load_context read, so it holds only this user's live rows:
# a category's name (own or default, vi and en) and keywords, a wallet's name and aliases, all folded the same way the
# question is. A word that names two rows is a tie: reported, never guessed. A word that names none links nothing.
from .routing import fold
from .tools.scope import category_name


def lexicon(categories, wallets, language):
    """{folded phrase: {(kind, id): entity}}"""
    owners = {}

    def add(phrase, entity):
        folded = fold(phrase or '').strip()
        if len(folded) > 1:  # a single letter is no word
            owners.setdefault(folded, {})[(entity['kind'], entity['id'])] = entity

    for category in categories:
        entity = {'kind': 'category', 'id': str(category['_id']), 'name': category_name(category, language), 'type': category.get('type')}
        for phrase in [category.get('name'), *(category.get('names') or {}).values(), *(category.get('keywords') or [])]:
            add(phrase, entity)
    for wallet in wallets:
        entity = {'kind': 'wallet', 'id': str(wallet['_id']), 'name': wallet['name']}
        for phrase in [wallet['name'], *(wallet.get('aliases') or [])]:
            add(phrase, entity)
    return owners


def link(text, categories, wallets, language):
    """(entities, ties) for the words of `text` (the question without its period words). The longest phrase goes first and
    its words are used up, so "an uong" is not also read as "an". Both lists are in the order the words came."""
    owners, words = lexicon(categories, wallets, language), fold(text)
    found, spent = [], words
    for phrase in sorted(owners, key=lambda phrase: (-len(phrase.split()), -len(phrase), phrase)):
        if f' {phrase} ' in spent:
            found.append((words.find(f' {phrase} '), phrase))
            spent = spent.replace(f' {phrase} ', ' # ')  # whole words only; '#' is in no phrase
    entities, ties = [], []
    for _, phrase in sorted(found):
        rows = sorted(owners[phrase].values(), key=lambda row: (row['kind'], row['name']))
        if len(rows) > 1:
            ties.append({'phrase': phrase, 'entities': rows})
        elif not any(row['id'] == rows[0]['id'] and row['kind'] == rows[0]['kind'] for row in entities):
            entities.append(rows[0])
    return entities, ties
