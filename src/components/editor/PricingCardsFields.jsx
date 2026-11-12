import { useState } from 'react'
import { useI18n } from '../../i18n/I18nContext'
import { useAdminText } from '../../admin/useAdminText'
import {
  LIMITS, MAX_CARDS, cardType, MAX_ITEM, MAX_LIST, addCard, cardProblem, cardsOf, duplicateCard, listProblem, patchCard, removeCard, reorder,
  setVisible, textOf, textProblem, withText,
} from '../../utils/landingCards'
import ConfirmDialog from './ConfirmDialog'
import { ButtonRow, SmallButton, ToggleField } from './fields'

// Pricing section, in the editor: the packs of the landing are written BY HAND here (no link with the catalogue of Admin > Packs).
// "Add pack" makes a blank card; each card has its own form with a live preview, duplicate, delete (with confirmation), reorder
// (drag or buttons) and hide / show. The same texts can also be edited on the page itself (double click).

const FIELDS = [
  { key: 'name', label: 'lp_f_name' },
  { key: 'tag', label: 'lp_f_tag' },
  { key: 'price', label: 'lp_f_price', placeholder: 'lp_ph_price' },
  { key: 'period', label: 'lp_f_period', placeholder: 'lp_ph_period' },
  { key: 'duration', label: 'lp_f_duration' },
  { key: 'totalSessions', label: 'lp_f_total' },
  { key: 'objective', label: 'lp_f_objective', multiline: true },
  { key: 'description', label: 'lp_f_description', multiline: true },
  { key: 'buttonText', label: 'lp_f_button' },
]

const CONTROL = 'w-full bg-[#111] border rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-emerald-500 transition'

function Counter({ shown, limit, t }) {
  return <span className={`text-[11px] tabular-nums ${shown > limit ? 'text-red-300' : 'text-gray-500'}`}>{t('lp_chars').replace('{n}', shown).replace('{max}', limit)}</span>
}

function TextRow({ field, card, language, onChange, t }) {
  const text = textOf(card[field.key], language)
  const problem = textProblem(card[field.key], LIMITS[field.key])
  const Tag = field.multiline ? 'textarea' : 'input'
  return (
    <div className="mb-4">
      <label className="mb-1 flex items-center justify-between gap-2 text-xs uppercase tracking-wider text-gray-400">
        <span>{t(field.label)}</span>
        <Counter shown={text.length} limit={LIMITS[field.key]} t={t} />
      </label>
      <Tag
        {...(field.multiline ? { rows: 2 } : { type: 'text' })}
        value={text}
        placeholder={field.placeholder ? t(field.placeholder) : undefined}
        aria-label={t(field.label)}
        aria-invalid={problem !== ''}
        onChange={event => onChange(withText(card[field.key], language, event.target.value))}
        className={`${CONTROL} ${problem ? 'border-red-400/60' : 'border-white/10'}`}
      />
      {problem && <p role="alert" className="mt-1 text-[11px] text-red-300">{t(problem)}</p>}
    </div>
  )
}

function ListRow({ label, items, language, onChange, t }) {
  const list = Array.isArray(items) ? items : []
  const problem = listProblem(list)
  const set = (index, text) => onChange(list.map((item, at) => (at === index ? withText(item, language, text) : item)))
  return (
    <div className="mb-4">
      <p className="mb-1 flex items-center justify-between text-xs uppercase tracking-wider text-gray-400">
        <span>{t(label)}</span>
        <span className={`text-[11px] tabular-nums ${list.length > MAX_LIST ? 'text-red-300' : 'text-gray-500'}`}>{t('lp_chars').replace('{n}', list.length).replace('{max}', MAX_LIST)}</span>
      </p>
      {list.map((item, index) => {
        const text = textOf(item, language)
        const itemProblem = textProblem(item, MAX_ITEM)
        return (
          <div key={index} className="mb-2">
            <div className="flex items-center gap-2">
              <input
                type="text" value={text} aria-label={`${t(label)} ${index + 1}`} aria-invalid={itemProblem !== ''}
                onChange={event => set(index, event.target.value)}
                className={`${CONTROL} ${itemProblem ? 'border-red-400/60' : 'border-white/10'}`}
              />
              <button type="button" onClick={() => onChange(reorder(list, index, index - 1))} disabled={index === 0} aria-label={t('lp_up')} className="px-1 text-gray-300 disabled:opacity-30">↑</button>
              <button type="button" onClick={() => onChange(reorder(list, index, index + 1))} disabled={index === list.length - 1} aria-label={t('lp_down')} className="px-1 text-gray-300 disabled:opacity-30">↓</button>
              <button type="button" onClick={() => onChange(list.filter((_item, at) => at !== index))} aria-label={t('lp_item_del')} className="px-1 text-red-400 hover:text-red-300">✕</button>
            </div>
            <div className="mt-0.5 text-right"><Counter shown={text.length} limit={MAX_ITEM} t={t} /></div>
          </div>
        )
      })}
      {problem && <p role="alert" className="mb-1 text-[11px] text-red-300">{t(problem)}</p>}
      <button
        type="button" onClick={() => onChange([...list, ''])} disabled={list.length >= MAX_LIST}
        className="text-emerald-400 text-xs uppercase tracking-wider hover:text-emerald-300 disabled:opacity-40"
      >
        + {t('lp_item_add')}
      </button>
    </div>
  )
}

// How the card will look on the page (a small version, drawn from the form as it is typed).
function CardPreview({ card, language, t }) {
  const dark = !!card.highlighted
  const text = (key) => textOf(card[key], language)
  const benefits = (card.benefits || []).map(item => textOf(item, language)).filter(Boolean)
  const features = (card.features || []).map(item => textOf(item, language)).filter(Boolean)
  const muted = dark ? 'text-gray-400' : 'text-gray-500'
  return (
    <div className="mb-4">
      <p className="mb-1 text-xs uppercase tracking-wider text-gray-400">{t('lp_preview')}</p>
      <div className={`p-4 ${dark ? 'border border-black bg-black text-white' : 'border border-black/10 bg-white text-black'}`}>
        {text('tag') && <p className={`mb-2 text-[10px] uppercase tracking-[2px] ${muted}`}>{text('tag')}</p>}
        <p className="break-words text-xl uppercase">{text('name') || t('lp_untitled')}</p>
        {text('duration') && <p className={`mt-1 text-xs ${muted}`}>{text('duration')}</p>}
        {text('objective') && <p className={`mt-2 text-xs leading-5 ${dark ? 'text-gray-300' : 'text-gray-600'}`}>{text('objective')}</p>}
        {benefits.length > 0 && (
          <ul className={`mt-2 space-y-0.5 text-xs ${dark ? 'text-gray-300' : 'text-gray-700'}`}>
            {benefits.map((item, index) => <li key={index} className="flex gap-1"><span aria-hidden="true">✓</span><span className="break-words">{item}</span></li>)}
          </ul>
        )}
        {(text('price') || text('period')) && <p className="mt-3 text-2xl font-bold">{text('price')}<span className="ml-1 text-sm font-normal">{text('period')}</span></p>}
        {text('totalSessions') && <p className={`text-xs ${muted}`}>{text('totalSessions')}</p>}
        {text('description') && <p className={`mt-2 text-xs ${dark ? 'text-gray-300' : 'text-gray-600'}`}>{text('description')}</p>}
        {features.length > 0 && (
          <ul className={`mt-2 space-y-0.5 text-xs ${dark ? 'text-gray-300' : 'text-gray-700'}`}>
            {features.map((item, index) => <li key={index} className="flex gap-1"><span aria-hidden="true">✓</span><span className="break-words">{item}</span></li>)}
          </ul>
        )}
        {text('buttonText') && <p className={`mt-3 inline-block border px-3 py-1 text-[10px] uppercase tracking-[2px] ${dark ? 'border-white' : 'border-black'}`}>{text('buttonText')}</p>}
      </div>
    </div>
  )
}

export default function PricingCardsFields({ sectionKey, content, updateField }) {
  const { language } = useI18n()
  const { t } = useAdminText()
  const section = content.sections[sectionKey] || {}
  const cards = cardsOf(section)
  const path = `sections.${sectionKey}.cards`
  const [openId, setOpenId] = useState(null)
  const [dragging, setDragging] = useState(null)
  const [deleting, setDeleting] = useState(null)         // index of the card waiting for the confirmation

  const save = (next) => updateField(path, next)
  const add = () => {
    const next = addCard(cards)
    if (next === cards) return
    save(next)
    setOpenId(next[next.length - 1].id)
  }
  const duplicate = (index) => {
    const next = duplicateCard(cards, index)
    if (next === cards) return
    save(next)
    setOpenId(next[index + 1].id)
  }

  return (
    <>
      <p className="text-xs uppercase tracking-wider text-emerald-400 mb-2 mt-6">{t('lp_title')} ({cards.length})</p>
      <p className="mb-4 text-xs text-gray-500">{t('lp_note')}</p>

      {cards.length === 0 && <p className="mb-4 rounded-lg border border-dashed border-white/15 px-3 py-4 text-sm text-gray-400">{t('lp_empty')}</p>}

      <ul>
        {cards.map((card, index) => {
          const open = openId === card.id
          const problem = cardProblem(card)
          return (
            <li
              key={card.id || index}
              draggable
              onDragStart={() => setDragging(index)}
              onDragOver={event => event.preventDefault()}
              onDrop={() => { if (dragging !== null) save(reorder(cards, dragging, index)); setDragging(null) }}
              onDragEnd={() => setDragging(null)}
              className={`border rounded-lg px-3 py-3 mb-3 ${problem ? 'border-red-400/40' : 'border-white/10'} ${card.visible === false ? 'opacity-60' : ''}`}
            >
              <div className="flex items-center justify-between gap-2">
                <button type="button" onClick={() => setOpenId(open ? null : card.id)} aria-expanded={open} title={t('lp_drag')} className="min-w-0 flex-1 truncate text-left text-sm font-medium">
                  ⠿ {textOf(card.name, language) || t('lp_untitled')}{card.visible === false ? ` · ${t('lp_hidden')}` : ''}
                </button>
                <button type="button" onClick={() => setOpenId(open ? null : card.id)} className="shrink-0 text-xs uppercase tracking-wider text-emerald-400 hover:text-emerald-300">
                  {open ? t('lp_close') : t('lp_edit')}
                </button>
              </div>

              <div className="mt-2">
                <ButtonRow>
                  <SmallButton onClick={() => save(reorder(cards, index, index - 1))} disabled={index === 0}>{t('lp_up')}</SmallButton>
                  <SmallButton onClick={() => save(reorder(cards, index, index + 1))} disabled={index === cards.length - 1}>{t('lp_down')}</SmallButton>
                  <SmallButton onClick={() => save(setVisible(cards, index, card.visible === false))}>{card.visible === false ? t('lp_show') : t('lp_hide')}</SmallButton>
                </ButtonRow>
              </div>

              {open && (
                <div className="mt-3 border-t border-white/10 pt-3">
                  <CardPreview card={card} language={language} t={t} />
                  <div className="mb-4" role="group" aria-label={t('lp_f_type')}>
                    <p className="mb-1 text-xs uppercase tracking-wider text-gray-400">{t('lp_f_type')}</p>
                    <div className="flex gap-2">
                      {['individual', 'dual'].map(type => (
                        <SmallButton key={type} variant={cardType(card) === type ? 'primary' : 'default'} onClick={() => save(patchCard(cards, index, { type }))}>
                          {t(type === 'dual' ? 'ty_dual' : 'ty_individual')}
                        </SmallButton>
                      ))}
                    </div>
                  </div>
                  {FIELDS.map(field => (
                    <TextRow key={field.key} field={field} card={card} language={language} t={t} onChange={value => save(patchCard(cards, index, { [field.key]: value }))} />
                  ))}
                  <ListRow label="lp_f_benefits" items={card.benefits} language={language} t={t} onChange={items => save(patchCard(cards, index, { benefits: items }))} />
                  <ListRow label="lp_f_features" items={card.features} language={language} t={t} onChange={items => save(patchCard(cards, index, { features: items }))} />
                  <ToggleField label={t('lp_f_highlight')} value={!!card.highlighted} onChange={() => save(patchCard(cards, index, { highlighted: !card.highlighted }))} />
                  <ButtonRow>
                    <SmallButton onClick={() => duplicate(index)} disabled={cards.length >= MAX_CARDS}>{t('lp_duplicate')}</SmallButton>
                    <SmallButton variant="danger" onClick={() => setDeleting(index)}>{t('lp_delete')}</SmallButton>
                  </ButtonRow>
                </div>
              )}
            </li>
          )
        })}
      </ul>

      <SmallButton variant="primary" onClick={add} disabled={cards.length >= MAX_CARDS}>+ {t('lp_add')}</SmallButton>
      {cards.length >= MAX_CARDS && <p className="mt-2 text-[11px] text-gray-500">{t('lp_max_cards')}</p>}

      <ConfirmDialog
        open={deleting !== null}
        title={t('lp_delete_title')}
        description={deleting !== null ? `${textOf(cards[deleting]?.name, language) || t('lp_untitled')} — ${t('lp_delete_text')}` : ''}
        confirmLabel={t('lp_delete')} cancelLabel={t('cancel')} variant="danger"
        onConfirm={() => { save(removeCard(cards, deleting)); setDeleting(null) }}
        onCancel={() => setDeleting(null)}
      />
    </>
  )
}
