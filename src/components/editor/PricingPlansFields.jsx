import { useState } from 'react'
import { useI18n } from '../../i18n/I18nContext'
import { useAdminText } from '../../admin/useAdminText'
import { resolveText } from '../../utils/multilingual'
import { formatMoney } from '../../utils/pricing'
import { usePricing } from '../../utils/usePricing'
import { addPack, availablePacks, itemsOf, reorder, removeAt, setVisible } from '../../utils/landingPricing'
import { makeDefaultPricingPlan } from '../../content/defaultContent'
import { ButtonRow, SmallButton, ToggleField } from './fields'

// Pricing section, in the editor: the plans of the landing are CHOSEN from the catalogue (Admin > Packs). A plan created in
// Packs is not on the landing until it is added here. Removing one only takes it off the landing (it stays in Packs).
export default function PricingPlansFields({ sectionKey, content, updateField }) {
  const { language } = useI18n()
  const { t } = useAdminText()
  const { prices } = usePricing()
  const section = content.sections[sectionKey] || {}
  const items = itemsOf(section)
  const cards = Array.isArray(section.plans) ? section.plans : []
  const packs = Array.isArray(prices?.packs) ? prices.packs : []
  const byId = new Map(packs.map(pack => [pack.id, pack]))
  const [picking, setPicking] = useState(false)
  const [dragging, setDragging] = useState(null)
  const itemsPath = `sections.${sectionKey}.planItems`
  const cardsPath = `sections.${sectionKey}.plans`
  const free = availablePacks(packs, section)

  const add = (pack) => {
    // a plain card for the texts of the new plan: the look of the last card, nothing written in it
    const last = cards[cards.length - 1] || makeDefaultPricingPlan()
    const blank = { ...makeDefaultPricingPlan(), period: last.period, buttonText: last.buttonText, description: '', features: [], name: '' }
    const next = addPack(section, pack.id, blank)
    if (!next) return
    updateField(cardsPath, next.plans)
    updateField(itemsPath, next.planItems)
    setPicking(false)
  }

  const patchCard = (index, patch) => updateField(cardsPath, cards.map((card, at) => (at === index ? { ...card, ...patch } : card)))

  return (
    <>
      <p className="text-xs uppercase tracking-wider text-emerald-400 mb-2 mt-6">{t('lp_title')} ({items.length})</p>
      <p className="mb-4 text-xs text-gray-500">{t('lp_note')}</p>

      {items.length === 0 && <p className="mb-4 rounded-lg border border-dashed border-white/15 px-3 py-4 text-sm text-gray-400">{t('lp_empty')}</p>}

      <ul>
        {items.map((item, index) => {
          const pack = byId.get(item.plan_id)
          const card = Number.isInteger(item.card) ? cards[item.card] : null
          return (
            <li
              key={`${item.plan_id}-${index}`}
              draggable
              onDragStart={() => setDragging(index)}
              onDragOver={event => event.preventDefault()}
              onDrop={() => { if (dragging !== null) updateField(itemsPath, reorder(items, dragging, index)); setDragging(null) }}
              onDragEnd={() => setDragging(null)}
              className={`border border-white/10 rounded-lg px-3 py-3 mb-3 ${item.visible === false ? 'opacity-60' : ''}`}
            >
              <div className="flex items-center justify-between mb-2 gap-2">
                <span className="text-sm font-medium truncate" title={t('lp_drag')}>⠿ {pack ? pack.name : t('lp_unavailable')}</span>
                <button onClick={() => updateField(itemsPath, removeAt(items, index))} className="text-red-400 text-xs uppercase tracking-wider hover:text-red-300 shrink-0">
                  {t('lp_remove')}
                </button>
              </div>
              {pack && (
                <p className="mb-2 text-xs text-gray-400">
                  {pack.session_type === 'dual' ? t('ty_dual') : t('ty_individual')} · {formatMoney(pack.price_per_session)} {item.visible === false ? `· ${t('lp_hidden')}` : ''}
                </p>
              )}
              <ButtonRow>
                <SmallButton onClick={() => updateField(itemsPath, reorder(items, index, index - 1))} disabled={index === 0}>{t('lp_up')}</SmallButton>
                <SmallButton onClick={() => updateField(itemsPath, reorder(items, index, index + 1))} disabled={index === items.length - 1}>{t('lp_down')}</SmallButton>
                <SmallButton onClick={() => updateField(itemsPath, setVisible(items, index, item.visible === false))}>
                  {item.visible === false ? t('lp_show') : t('lp_hide')}
                </SmallButton>
              </ButtonRow>

              {card && (
                <>
                  <ToggleField label={t('lp_highlight')} value={!!card.highlighted} onChange={() => patchCard(item.card, { highlighted: !card.highlighted })} />
                  <p className="text-[11px] uppercase tracking-wider text-gray-500 mb-2">{t('lp_features')}</p>
                  {(card.features || []).map((feature, featureIndex) => (
                    <div key={featureIndex} className="flex items-center justify-between text-xs text-gray-300 mb-1">
                      <span className="truncate">• {resolveText(feature, language)}</span>
                      <button onClick={() => patchCard(item.card, { features: card.features.filter((_f, at) => at !== featureIndex) })} className="text-red-400 hover:text-red-300 ml-2" aria-label={t('cat_benefit_del')}>✕</button>
                    </div>
                  ))}
                  <button
                    onClick={() => patchCard(item.card, { features: [...(card.features || []), { en: 'New feature', es: 'Nueva característica', ca: 'Nova característica' }] })}
                    className="text-emerald-400 text-xs uppercase tracking-wider hover:text-emerald-300 mt-1"
                  >
                    {t('lp_feature_add')}
                  </button>
                </>
              )}
            </li>
          )
        })}
      </ul>

      {picking ? (
        <div className="border border-emerald-400/30 rounded-lg px-3 py-3">
          <p className="mb-2 text-xs uppercase tracking-wider text-gray-400">{t('lp_pick')}</p>
          {free.length === 0 && <p className="text-sm text-gray-400">{t('lp_add_none')}</p>}
          <ul className="space-y-2">
            {free.map(pack => (
              <li key={pack.id}>
                <button onClick={() => add(pack)} className="w-full rounded-lg border border-white/10 px-3 py-2 text-left text-sm hover:border-emerald-400/50">
                  <span className="block truncate font-medium">{pack.name}</span>
                  <span className="block text-xs text-gray-400">{pack.session_type === 'dual' ? t('ty_dual') : t('ty_individual')} · {formatMoney(pack.price_per_session)}</span>
                </button>
              </li>
            ))}
          </ul>
          <div className="mt-3"><SmallButton onClick={() => setPicking(false)}>{t('cancel')}</SmallButton></div>
        </div>
      ) : (
        <SmallButton variant="primary" onClick={() => setPicking(true)}>+ {t('lp_add')}</SmallButton>
      )}
    </>
  )
}
