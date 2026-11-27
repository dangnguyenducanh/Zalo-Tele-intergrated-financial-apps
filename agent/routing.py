# find_skills' ranking (docs/02 §2.11.3 "Routing", decision D17): two lists over the enabled skills, one by words and one
# by the embedding, fused with reciprocal-rank fusion (RRF, k = 60).
#
# A skill in both lists at rank 1 scores 2/61, and nothing scores more, so a fused score divided by that (BEST) is 0..1.
# The lexical list holds only the skills with a word match, so a skill nothing matched is not carried up by its place in
# the other list. Then:
#   direct  an exact trigger, else one skill whose own words are in the question (an anchored skill: "ngân sách", "tổng kết tuần"), else a decisive
#           pair (a question phrase and a linked entity), or a first place at least GAP ahead
#   none    no word matches and the best cosine is under MIN_COSINE
#   choose  anything else: the top 3, and the model (T63) or an ask-back picks
import re
from dataclasses import dataclass

from .tools.period import normalize

RRF_K = 60
BEST = 2 / (RRF_K + 1)
GAP = 0.15  # the first place's lead over the second, after dividing by BEST
MIN_COSINE = 0.5  # ponytail: a first guess for bge-m3; the skill eval on the GPU host (docs/07 §7.9.6) tunes it


def fold(text):
    """The words of a text without accents or punctuation, with a space at both ends so a phrase matches whole words only."""
    return ' ' + re.sub(r'[^a-z0-9/]+', ' ', normalize(text)).strip() + ' '


def cosine(a, b):
    return sum(x * y for x, y in zip(a, b))  # both are unit vectors, so this is the cosine


@dataclass
class Match:
    words: int = 0  # the words of the triggers that were found
    exact: bool = False  # the whole question is a trigger
    decisive: bool = False  # a pair: a question phrase and an entity the question links
    anchored: bool = False  # a trigger of a skill whose triggers are its own words was found


def match_of(skill, text, kinds):
    """How the words of one skill meet the folded question `text`, given the kinds of entity it links ('category', 'wallet')."""
    found = Match()
    for trigger in skill.triggers:
        folded = fold(trigger)
        if folded in text:
            found.words += len(folded.split())
            found.exact |= folded == text
            found.anchored |= skill.anchored
    for pair in skill.pairs:
        if pair['entity'] in kinds and any(fold(phrase) in text for phrase in pair['phrases']):
            found.words += 1
            found.decisive = True
    return found


def rank(text, entities, skills, vectors, query):
    """The skills that may answer `text` (the enabled ones: {code: Skill}), best first, and what to do with them.
    `vectors` is {code: embedding} and `query` the question's embedding (None: only the words count).
    Returns (retrieval, [{code, score}] with at most 3, score = fused / BEST)."""
    folded, kinds = fold(text), {entity['kind'] for entity in entities}
    found = {code: match_of(skill, folded, kinds) for code, skill in skills.items()}
    lexical = sorted((code for code in skills if found[code].words), key=lambda code: (-found[code].decisive, -found[code].words, code))
    close = {code: cosine(query, vectors[code]) for code in skills if query is not None and code in vectors}
    semantic = sorted(close, key=lambda code: (-close[code], code))
    score = {code: sum(1 / (RRF_K + ranking.index(code) + 1) for ranking in (lexical, semantic) if code in ranking) / BEST for code in skills}
    top = sorted((code for code in skills if score[code]), key=lambda code: (-score[code], code))
    if not lexical and (not close or max(close.values()) < MIN_COSINE):
        return 'none', []
    exact = [code for code in lexical if found[code].exact]
    anchored = [code for code in lexical if found[code].anchored]
    decisive = [code for code in lexical if found[code].decisive]
    # An anchor names the topic itself, so it outranks the generic question word of a pair ("ngân sách ăn uống còn bao nhiêu" is the budget, not the category).
    # Two anchored skills in one question are not told apart by their anchors: the pairs then decide nothing either, so it is a choose.
    winner = exact[0] if len(exact) == 1 else anchored[0] if len(anchored) == 1 else decisive[0] if len(decisive) == 1 and not anchored else None
    if winner is None and (len(top) == 1 or score[top[0]] - score[top[1]] >= GAP):
        winner = top[0]
    if winner:
        top = [winner, *(code for code in top if code != winner)]
    return 'direct' if winner else 'choose', [{'code': code, 'score': round(score[code], 3)} for code in top[:3]]
