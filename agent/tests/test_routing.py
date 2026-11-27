# Reading a question without the model (docs/02 §2.11.3, docs/07 §7.9.2): the lexicon that links words to the user's own
# categories and wallets, and the hybrid ranking of find_skills with its two thresholds (decision D17). No database here:
# the rows and the vectors are written out by hand.
import math
from dataclasses import replace

import pytest
from bson import ObjectId

from agent import routing
from agent.lexicon import link
from agent.skills import load_skills
from agent.tools import default_registry
from agent.tools.period import find_period, words_of


def category(default, keywords=(), kind='expense', **fields):
    """A category row: `default` is its name in both languages; a `name=` field is the user's own name for it."""
    return {'_id': ObjectId(), 'type': kind, 'names': {'vi': default, 'en': default}, 'keywords': list(keywords), **fields}


def wallet(name, aliases=()):
    return {'_id': ObjectId(), 'name': name, 'type': 'cash', 'aliases': list(aliases)}


FOOD, MOVE = category('Ăn uống', ['pho', 'cafe', 'ca phe', 'an sang']), category('Đi lại', ['grab', 'be'])
GIFT = category('Được tặng', ['li xi', 'qua'], kind='income')
CASH, MOMO = wallet('Tiền mặt', ['tm', 'cash']), wallet('MoMo', ['mm'])
CATEGORIES, WALLETS = [FOOD, MOVE, GIFT], [CASH, MOMO]


def linked(text, categories=CATEGORIES, wallets=WALLETS, language='vi'):
    """(names of the linked rows, ties) for the question as rewrite_question sees it: period words already taken out."""
    entities, ties = link(find_period(words_of(text)).rest, categories, wallets, language)
    return [(e['kind'], e['name']) for e in entities], ties


# ---- lexicon linking ----

def test_words_link_to_the_users_own_categories_and_wallets_without_accents_or_case():
    """TC-F14-60 "an uong thang nay" links Ăn uống, "momo con bao nhieu" the wallet MoMo and "cà phê" the category that has "ca phe" as a keyword, with or without accents"""
    assert linked('an uong thang nay')[0] == [('category', 'Ăn uống')]
    assert linked('ĂN UỐNG tháng này')[0] == [('category', 'Ăn uống')]
    assert linked('momo con bao nhieu')[0] == [('wallet', 'MoMo')]
    assert linked('MoMo còn bao nhiêu?')[0] == [('wallet', 'MoMo')]
    assert linked('cà phê')[0] == [('category', 'Ăn uống')]  # a keyword, written with accents against a keyword without
    assert linked('tm còn bao nhiêu')[0] == [('wallet', 'Tiền mặt')]  # a wallet alias
    assert linked('tiền mặt')[0] == [('wallet', 'Tiền mặt')]
    entities, ties = link('an uong', CATEGORIES, WALLETS, 'vi')
    assert ties == [] and set(entities[0]) == {'kind', 'id', 'name', 'type'} and entities[0]['id'] == str(FOOD['_id']) and entities[0]['type'] == 'expense'


def test_several_words_link_in_the_order_they_came_and_a_row_is_linked_once():
    """TC-F14-60 Two rows named in one question are both linked, in word order; the same row named twice (its name and a keyword) is linked once"""
    assert linked('grab và phở an uong')[0] == [('category', 'Đi lại'), ('category', 'Ăn uống')]  # grab is Đi lại, pho and an uong are Ăn uống
    assert linked('an uong momo')[0] == [('category', 'Ăn uống'), ('wallet', 'MoMo')]
    assert linked('momo an uong')[0] == [('wallet', 'MoMo'), ('category', 'Ăn uống')]
    assert linked('ăn uống pho cafe')[0] == [('category', 'Ăn uống')]


def test_the_longest_phrase_wins_and_only_whole_words_link():
    """TC-F14-60 "an sang" is one keyword, not "an" plus something; a word inside another word links nothing ("be" is not in "ben")"""
    rows = [category('Cơm', ['an']), category('Bữa sáng', ['an sang'])]
    assert linked('an sang', rows, [])[0] == [('category', 'Bữa sáng')]  # the two-word keyword used its words up: "an" is not also read
    assert linked('an', rows, [])[0] == [('category', 'Cơm')]
    assert linked('ben xe', CATEGORIES, [])[0] == []
    assert linked('grabbing', CATEGORIES, [])[0] == []


def test_a_word_that_names_two_rows_is_a_tie_and_links_neither():
    """TC-F14-60 A category and a wallet with the same name, or two categories that share a keyword: reported as a tie, never guessed"""
    twin_category, twin_wallet = category('Momo', ['momo']), wallet('Momo')
    entities, ties = linked('momo con bao nhieu', [FOOD, twin_category], [CASH, twin_wallet])
    assert entities == []
    [tie] = ties
    assert tie['phrase'] == 'momo' and {(e['kind'], e['name']) for e in tie['entities']} == {('category', 'Momo'), ('wallet', 'Momo')}
    shared = [category('Xăng', ['xe']), category('Gửi xe', ['xe'])]
    entities, ties = linked('xe thang nay', shared, [])
    assert entities == [] and [t['phrase'] for t in ties] == ['xe']
    entities, ties = linked('xe an uong', shared + [FOOD], [])  # the other word still links
    assert entities == [('category', 'Ăn uống')] and len(ties) == 1


def test_an_unknown_word_links_nothing_and_so_does_nothing_at_all():
    """TC-F14-60 A word no category or wallet owns, an empty question and a user with no rows link nothing and report no tie"""
    assert linked('thuê nhà bao nhiêu') == ([], [])
    assert linked('') == ([], [])
    assert linked('an uong', [], []) == ([], [])


def test_the_name_is_the_one_the_user_sees_and_a_renamed_copy_links_by_its_new_name():
    """TC-F14-60 The linked row carries its own name when it has one, else the default in the reply language; the old default still links too"""
    renamed = category('Ăn uống', ['pho'], name='Cơm nhà')
    assert linked('com nha', [renamed], [])[0] == [('category', 'Cơm nhà')]
    assert linked('an uong', [renamed], [])[0] == [('category', 'Cơm nhà')]
    english = {'_id': ObjectId(), 'type': 'expense', 'names': {'vi': 'Giải trí', 'en': 'Fun'}, 'keywords': []}
    assert linked('giai tri', [english], [], 'en')[0] == [('category', 'Fun')]
    assert linked('fun', [english], [], 'vi')[0] == [('category', 'Giải trí')]


def test_the_words_of_a_period_phrase_are_not_linked():
    """TC-F14-60 "7 ngày qua" and "hôm qua" do not link the category whose keyword is "qua" (a gift), while "quà" alone does"""
    assert linked('chi 7 ngày qua')[0] == []
    assert linked('hôm qua tiêu bao nhiêu')[0] == []
    assert linked('quà tháng này')[0] == [('category', 'Được tặng')]


# ---- skill ranking ----

SKILLS = load_skills(default_registry())
CODES = sorted(SKILLS)  # chi_theo_danh_muc, so_du_vi, thu_chi_ky


def unit(i, n=8):
    return [1.0 if k == i else 0.0 for k in range(n)]


def at_cosine(i, c, n=8):
    """A unit vector whose cosine with unit(i) is exactly c (the rest of it is in the last place)."""
    vector = [0.0] * n
    vector[i], vector[-1] = c, math.sqrt(1 - c * c)
    return vector


VECTORS = {code: unit(i) for i, code in enumerate(CODES)}
ENTITY = {'category': {'kind': 'category', 'id': 'c1', 'name': 'Ăn uống'}, 'wallet': {'kind': 'wallet', 'id': 'w1', 'name': 'MoMo'}}


def rank(text, entities=(), skills=SKILLS, vectors=VECTORS, query=None):
    return routing.rank(text, [ENTITY[kind] for kind in entities], skills, vectors, query if query is not None else unit(7))  # unit(7): near nothing


def test_the_best_score_is_one_and_the_constants_are_the_ones_of_decision_d17():
    """TC-F14-61 RRF k is 60, so a skill first in both lists scores 2/61 and its normalised score is 1; the gap is 0.15"""
    assert routing.RRF_K == 60 and routing.GAP == 0.15 and math.isclose(routing.BEST, 2 / 61) and 0 < routing.MIN_COSINE < 1
    retrieval, candidates = rank('hôm nay tiêu bao nhiêu', query=VECTORS['thu_chi_ky'])
    assert retrieval == 'direct' and candidates[0] == {'code': 'thu_chi_ky', 'score': 1.0} and all(0 < c['score'] <= 1 for c in candidates) and len(candidates) <= 3


def test_one_skill_with_a_word_match_is_direct_by_a_gap_far_over_a_fifth_and_two_close_ones_are_choose():
    """TC-F14-61 The gap threshold is reachable from both sides: one lexical match leads by about 0.5 (direct), two lexical matches by about 0.016 (choose, the top 3, best first)"""
    retrieval, candidates = rank('hôm nay tiêu bao nhiêu', query=VECTORS['thu_chi_ky'])
    assert retrieval == 'direct'
    assert candidates[0]['score'] - candidates[1]['score'] >= routing.GAP and math.isclose(candidates[0]['score'] - candidates[1]['score'], 0.508, abs_tol=0.01)
    both = 'số dư tháng này tiêu bao nhiêu'  # so_du_vi by "số dư", thu_chi_ky by "tiêu" and "bao nhiêu": no pair, no exact trigger
    second_best = [a + b / 2 for a, b in zip(VECTORS['thu_chi_ky'], VECTORS['so_du_vi'])]  # the vector likes thu_chi_ky, then so_du_vi
    retrieval, candidates = rank(both, query=second_best)
    assert retrieval == 'choose' and len(candidates) == 3
    assert [c['code'] for c in candidates][:2] == ['thu_chi_ky', 'so_du_vi'] and candidates[0]['score'] == 1.0
    assert candidates[1]['score'] == round(61 / 62, 3) and candidates[0]['score'] - candidates[1]['score'] < routing.GAP  # (1/62 + 1/62) / (2/61)
    assert candidates[2]['code'] == 'chi_theo_danh_muc' and candidates[2]['score'] < candidates[1]['score']  # the third place: the vector alone


def test_an_exact_trigger_and_a_decisive_pair_are_direct_whatever_the_other_skills_match():
    """TC-F14-61 The whole question equal to a trigger is direct even when another skill matches inside it and the vector prefers that one; a question phrase next to a linked row of the right kind is decisive over a skill the words also match"""
    base = SKILLS['thu_chi_ky']
    week = replace(base, code='tong_ket_tuan', triggers=['tổng kết tuần'], pairs=[])
    month = replace(base, code='tong_ket_thang', triggers=['tổng kết'], pairs=[])
    two = {'tong_ket_tuan': week, 'tong_ket_thang': month}
    vectors = {'tong_ket_tuan': unit(0), 'tong_ket_thang': unit(1)}
    retrieval, candidates = routing.rank('tổng kết tuần', [], two, vectors, unit(1))  # both match; the vector prefers the month
    assert (retrieval, candidates[0]['code']) == ('direct', 'tong_ket_tuan')  # "tổng kết tuần" is the whole of the week's trigger
    assert routing.rank('tổng kết tuần trước', [], two, vectors, unit(1))[0] == 'choose'  # a longer question is no longer exactly a trigger
    assert routing.rank('tổng kết', [], two, vectors, unit(1))[1][0]['code'] == 'tong_ket_thang'
    for text, kind, winner in [('tháng này ăn uống hết bao nhiêu', 'category', 'chi_theo_danh_muc'), ('momo còn bao nhiêu', 'wallet', 'so_du_vi'),
                               ('đi lại tuần trước tiêu bao nhiêu', 'category', 'chi_theo_danh_muc')]:
        retrieval, candidates = rank(text, [kind], query=VECTORS['thu_chi_ky'])  # the vector prefers thu_chi_ky: the pair still wins
        assert (retrieval, candidates[0]['code']) == ('direct', winner), text
    assert rank('momo còn bao nhiêu')[0] == 'choose'  # the same words with no wallet linked: so_du_vi and thu_chi_ky both match, nobody is decisive


def test_a_pair_needs_the_right_kind_of_row_and_two_pairs_decide_nothing():
    """TC-F14-61 A category next to "còn bao nhiêu" is the category pair, not the wallet one; a category and a wallet each completing a pair are two winners, so the answer is choose"""
    retrieval, candidates = rank('ăn uống còn bao nhiêu', ['category'])
    assert (retrieval, candidates[0]['code']) == ('direct', 'chi_theo_danh_muc')
    assert rank('còn bao nhiêu', ['category'])[1][0]['code'] == 'so_du_vi'  # it is also the whole of so_du_vi's own trigger: exact first
    retrieval, candidates = rank('momo ăn uống số dư tiêu', ['wallet', 'category'], query=VECTORS['so_du_vi'])
    assert retrieval == 'choose' and {c['code'] for c in candidates[:2]} == {'chi_theo_danh_muc', 'so_du_vi'}


def test_no_word_match_and_a_far_vector_is_none_and_a_near_one_is_choose():
    """TC-F14-61 The none threshold is reachable from both sides: with no word match, a best cosine just under the constant is none and exactly the constant is choose"""
    under = at_cosine(0, routing.MIN_COSINE - 1e-6)
    over = at_cosine(0, routing.MIN_COSINE)
    assert rank('xin chào bạn', query=unit(7)) == ('none', [])
    assert rank('xin chào bạn', query=under) == ('none', [])
    retrieval, candidates = rank('xin chào bạn', query=over)
    assert retrieval == 'choose' and candidates[0]['code'] == CODES[0]  # a vector alone never makes it direct: two skills are never 0.15 apart by rank
    assert rank('xin chào bạn', query=unit(0))[0] == 'choose'
    assert rank('xin chào bạn', query=None) == ('none', [])  # no embedder, no vectors: words only
    assert rank('xin chào bạn', vectors={}, query=unit(0)) == ('none', [])


def test_a_disabled_skill_is_never_a_candidate_and_a_single_skill_is_direct():
    """TC-F14-61 Only the skills passed in are ranked (find_skills passes the enabled pipeline ones): the trigger of one that is left out matches nothing; with one skill left a word match is direct"""
    only = {code: skill for code, skill in SKILLS.items() if code != 'thu_chi_ky'}
    assert rank('hôm nay tiêu bao nhiêu', skills=only, query=unit(7))[0] == 'none'
    for text in ('số dư', 'số dư bao nhiêu'):
        retrieval, candidates = rank(text, skills={'so_du_vi': SKILLS['so_du_vi']}, query=unit(7))
        assert (retrieval, [c['code'] for c in candidates]) == ('direct', ['so_du_vi'])
    assert 'thu_chi_ky' not in [c['code'] for c in rank('thu bao nhiêu', skills=only, query=VECTORS['thu_chi_ky'])[1]]


@pytest.mark.parametrize('code', CODES)
def test_the_skill_files_have_what_routing_and_the_answer_need(code):
    """TC-F14-61 Each skill has examples, triggers, 2-3 follow-ups in both languages, and a pair names a kind of row that the lexicon can link"""
    skill = SKILLS[code]
    assert skill.examples and skill.triggers and 2 <= len(skill.followups) <= 3
    assert all(pair['entity'] in ('category', 'wallet') and pair['phrases'] for pair in skill.pairs)
    assert skill.mode == 'pipeline' and skill.tools and all(tool.name in default_registry().tools for tool in skill.tools)
