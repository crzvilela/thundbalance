import { useI18n } from '../../i18n/I18nContext'
import { useAdminText } from '../../admin/useAdminText'
import { moveItem } from '../../utils/packFields'
import {
  FEATURE_LIMIT, MAX_FEATURES, PRICE_LIMIT, TIERS, TYPES, featuresProblem, textOf, textProblem, tierOf, withText, withTier,
} from '../../utils/landingPrices'
import { ToggleField } from './fields'

// Pricing section, in the editor: two blocks, Individual and Dual, each with its three prices (Monthly, Quarterly, Semiannual):
// the price (free text) and the features (0 to 10), with a live preview of the card. Written by hand: nothing is linked to Packs.
// The same texts can also be edited on the page itself (double click). The description, button and highlight of each plan are
// the section's three text cards, shared by both boxes.

const CONTROL = 'w-full bg-[#111] border rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-emerald-500 transition'

function Counter({ shown, limit, t }) {
  return <span className={`text-[11px] tabular-nums ${shown > limit ? 'text-red-300' : 'text-gray-500'}`}>{t('lp_chars').replace('{n}', shown).replace('{max}', limit)}</span>
}

function TierPreview({ tier, highlighted, label, language, t }) {
  const features = (tier.features || []).map(item => textOf(item, language)).filter(Boolean)
  const price = textOf(tier.price, language)
  return (
    <div className="mb-3">
      <p className="mb-1 text-[11px] uppercase tracking-wider text-gray-500">{t('lp_preview')}</p>
      <div className={`p-4 ${highlighted ? 'border border-black bg-black text-white' : 'border border-black/10 bg-white text-black'}`}>
        <p className="text-lg uppercase">{label}</p>
        <p className="mt-1 text-2xl font-bold break-words">{price || '—'}</p>
        {features.length > 0 && (
          <ul className={`mt-2 space-y-0.5 text-xs ${highlighted ? 'text-gray-300' : 'text-gray-700'}`}>
            {features.map((item, index) => <li key={index} className="flex gap-1"><span aria-hidden="true">✓</span><span className="break-words">{item}</span></li>)}
          </ul>
        )}
      </div>
    </div>
  )
}

function TierEditor({ section, type, index, language, t, onChange, highlighted }) {
  const tier = tierOf(section, type, index)
  const label = t(`lp_t_${TIERS[index]}`)
  const price = textOf(tier.price, language)
  const priceProblem = textProblem(tier.price, PRICE_LIMIT)
  const features = Array.isArray(tier.features) ? tier.features : []
  const listProblem = featuresProblem(features)
  const setFeature = (at, text) => onChange({ features: features.map((item, position) => (position === at ? withText(item, language, text) : item)) })
  return (
    <div className="mb-4 rounded-lg border border-white/10 px-3 py-3">
      <p className="mb-2 text-sm font-medium">{label}</p>
      <TierPreview tier={tier} highlighted={highlighted} label={label} language={language} t={t} />

      <div className="mb-3">
        <label className="mb-1 flex items-center justify-between gap-2 text-xs uppercase tracking-wider text-gray-400">
          <span>{t('lp_f_price')}</span><Counter shown={price.length} limit={PRICE_LIMIT} t={t} />
        </label>
        <input
          type="text" value={price} placeholder={t('lp_ph_price')} aria-label={`${t(type === 'dual' ? 'ty_dual' : 'ty_individual')} · ${label} · ${t('lp_f_price')}`}
          aria-invalid={priceProblem !== ''} onChange={event => onChange({ price: withText(tier.price, language, event.target.value) })}
          className={`${CONTROL} ${priceProblem ? 'border-red-400/60' : 'border-white/10'}`}
        />
        {priceProblem && <p role="alert" className="mt-1 text-[11px] text-red-300">{t(priceProblem)}</p>}
      </div>

      <div>
        <p className="mb-1 flex items-center justify-between text-xs uppercase tracking-wider text-gray-400">
          <span>{t('lp_f_features')}</span>
          <span className={`text-[11px] tabular-nums ${features.length > MAX_FEATURES ? 'text-red-300' : 'text-gray-500'}`}>{t('lp_chars').replace('{n}', features.length).replace('{max}', MAX_FEATURES)}</span>
        </p>
        {features.map((item, at) => {
          const text = textOf(item, language)
          const problem = textProblem(item, FEATURE_LIMIT)
          return (
            <div key={at} className="mb-2">
              <div className="flex items-center gap-2">
                <input
                  type="text" value={text} aria-label={`${label} · ${t('lp_f_features')} ${at + 1}`} aria-invalid={problem !== ''}
                  onChange={event => setFeature(at, event.target.value)}
                  className={`${CONTROL} ${problem ? 'border-red-400/60' : 'border-white/10'}`}
                />
                <button type="button" onClick={() => onChange({ features: moveItem(features, at, -1) })} disabled={at === 0} aria-label={t('lp_up')} className="px-1 text-gray-300 disabled:opacity-30">↑</button>
                <button type="button" onClick={() => onChange({ features: moveItem(features, at, 1) })} disabled={at === features.length - 1} aria-label={t('lp_down')} className="px-1 text-gray-300 disabled:opacity-30">↓</button>
                <button type="button" onClick={() => onChange({ features: features.filter((_item, position) => position !== at) })} aria-label={t('lp_item_del')} className="px-1 text-red-400 hover:text-red-300">✕</button>
              </div>
              <div className="mt-0.5 text-right"><Counter shown={text.length} limit={FEATURE_LIMIT} t={t} /></div>
            </div>
          )
        })}
        {listProblem && <p role="alert" className="mb-1 text-[11px] text-red-300">{t(listProblem)}</p>}
        <button
          type="button" onClick={() => onChange({ features: [...features, ''] })} disabled={features.length >= MAX_FEATURES}
          className="text-emerald-400 text-xs uppercase tracking-wider hover:text-emerald-300 disabled:opacity-40"
        >
          + {t('lp_item_add')}
        </button>
      </div>
    </div>
  )
}

export default function PricingTiersFields({ sectionKey, content, updateField }) {
  const { language } = useI18n()
  const { t } = useAdminText()
  const section = content.sections[sectionKey] || {}
  const plans = Array.isArray(section.plans) ? section.plans : []
  const prices = (type, index) => (patch) => updateField(`sections.${sectionKey}.prices`, withTier(section, type, index, patch))

  return (
    <>
      <p className="text-xs uppercase tracking-wider text-emerald-400 mb-2 mt-6">{t('lp_title')}</p>
      <p className="mb-4 text-xs text-gray-500">{t('lp_note')}</p>

      {TYPES.map(type => (
        <section key={type} className="mb-6" aria-label={t(type === 'dual' ? 'ty_dual' : 'ty_individual')}>
          <p className="mb-3 border-b border-white/10 pb-1 text-sm font-semibold uppercase tracking-wider">{t(type === 'dual' ? 'ty_dual' : 'ty_individual')}</p>
          {TIERS.map((_tier, index) => (
            <TierEditor
              key={`${type}-${index}`} section={section} type={type} index={index} language={language} t={t}
              highlighted={!!plans[index]?.highlighted} onChange={prices(type, index)}
            />
          ))}
        </section>
      ))}

      <p className="mb-2 text-xs uppercase tracking-wider text-gray-400">{t('lp_shared')}</p>
      {TIERS.map((tierName, index) => (
        <ToggleField
          key={tierName} label={`${t('lp_highlight')}: ${t(`lp_t_${tierName}`)}`} value={!!plans[index]?.highlighted}
          onChange={() => updateField(`sections.${sectionKey}.plans`, TIERS.map((_item, at) => (at === index ? { ...(plans[at] || {}), highlighted: !plans[at]?.highlighted } : (plans[at] || {}))))}
        />
      ))}
    </>
  )
}
