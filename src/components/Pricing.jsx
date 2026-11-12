import { EditableText, useSectionSelection, SectionEditOverlay } from './editor/Editable'
import { SectionBackgroundImage, sectionBackgroundStyle } from './editor/SectionBackground'
import MovableBox from './editor/MovableBox'
import { useState } from 'react'
import { useI18n } from '../i18n/I18nContext'
import { resolveText } from '../utils/multilingual'
import SegmentedType from './forms/SegmentedType'
import { formatMoney, packQuote } from '../utils/pricing'
import { entriesFor } from '../utils/landingPricing'
import { usePricing } from '../utils/usePricing'
import PackExtras from './PackExtras'

function Pricing({ sectionId }) {
  const { section, isEditMode, isSelected, onSectionClick, visible, theme } = useSectionSelection(sectionId, 'Pricing')
  const { t, language } = useI18n()
  // The packs and their prices are not part of the page text: they come from the server (the catalogue edited in Admin > Packs).
  // There is one card per pack on sale of the chosen type (Individual | Dual), in the order of the catalogue. The cards of this
  // page give the texts (description, features, button); a pack without a card of its own gets a plain one.
  const { prices, failed } = usePricing()
  const [sessionType, setSessionType] = useState('individual')

  if (!visible && !isEditMode) return null

  // The page draws only the packs of ITS list (section.planItems, set from the editor: "Añadir plan"). A pack created in
  // Admin > Packs is not here until the admin adds it. Name, price, goal and benefits are read live from the catalogue; the
  // texts of the card (description, features, button) come from the card of the item.
  const pageCards = Array.isArray(section.plans) ? section.plans : []
  const entries = entriesFor(section, prices?.packs, sessionType)
  const lastCard = pageCards[pageCards.length - 1] || {}

  return (
    <section
      id={sectionId}
      onClick={onSectionClick}
      style={sectionBackgroundStyle(section.background)}
      className={`relative isolate bg-white text-black py-20 md:py-40 px-6 ${!visible ? 'opacity-40' : ''}`}
    >
      <SectionEditOverlay isEditMode={isEditMode} isSelected={isSelected} hidden={!visible} label="Pricing" />
      <SectionBackgroundImage background={section.background} />

      <div className="max-w-7xl mx-auto">

        <div className="mb-12 md:mb-20 text-center">
          <EditableText
            as="p"
            path={`sections.${sectionId}.eyebrow`}
            styleObj={`sections.${sectionId}.eyebrowStyle`}
            label="Pricing Eyebrow"
            style={{ fontFamily: theme.typography.accentFont }}
            className="uppercase tracking-[5px] text-sm text-gray-500 mb-6"
          />

          <EditableText
            as="h2"
            path={`sections.${sectionId}.title`}
            styleObj={`sections.${sectionId}.titleStyle`}
            label="Pricing Title"
            style={{ fontFamily: theme.typography.headingFont }}
            className="text-4xl sm:text-5xl md:text-7xl"
          />
        </div>

        <div className="mb-10 flex justify-center">
          <SegmentedType
            value={sessionType} onChange={setSessionType}
            labels={{ legend: t('st_prices_for'), individual: t('st_individual'), dual: t('st_dual') }}
            tone="light" className="text-center [&_legend]:mx-auto"
          />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">

          {entries.map(({ pack, cardIndex: index }) => {
            const own = index != null                       // a card of its own (editable) or a plain one
            const plan = own ? pageCards[index] : { ...lastCard, description: '', features: [], highlighted: false, extra: true }
            const highlighted = !!plan.highlighted
            const quote = packQuote(pack, pack?.sessions_per_week_options?.[0])
            const single = pack && pack.sessions_per_week_options.length === 1
            const frame = (children) => (own
              ? <MovableBox key={pack.id} path={`sections.${sectionId}.plans.${index}.card`} label={`Plan ${index + 1} Card`} className="h-full">{children}</MovableBox>
              : <div key={pack.id} className="h-full">{children}</div>)

            return frame(
              <div
                className={`h-full p-10 hover:-translate-y-2 transition duration-500 ${
                  highlighted
                    ? 'border border-black bg-black text-white'
                    : 'border border-black/10'
                }`}
              >
                {/* the name of a pack is the one field of the catalogue (one language: the one the admin wrote) */}
                <h3 style={{ fontFamily: theme.typography.headingFont }} className="text-3xl mb-1 uppercase block">{pack.name}</h3>
                {<p className={`mb-4 text-sm ${highlighted ? 'text-gray-400' : 'text-gray-500'}`}>{t('st_weeks').replace('{n}', pack.weeks)} · {pack.sessions_per_week_options.length > 1 ? t('st_per_week_options').replace('{list}', pack.sessions_per_week_options.join(' / ')) : t('st_per_week_one').replace('{n}', pack.sessions_per_week_options[0])}</p>}

                <PackExtras pack={pack} t={t} tone={highlighted ? 'dark' : 'light'} className="mb-4" />

                <div className="mb-6">
                  <div className="text-5xl font-bold">
                    <span aria-live="polite">{prices ? formatMoney(quote.perSession) : '—'}</span>
                    {!own
                      ? <span className="text-xl ml-1">{resolveText(plan.period, language)}</span>      // the period is stored per language: an extra card (a pack without a card of its own) must not draw the object
                      : (
                        <EditableText
                          as="span"
                          path={`sections.${sectionId}.plans.${index}.period`}
                          styleObj={`sections.${sectionId}.plans.${index}.periodStyle`}
                          label={`Plan ${index + 1} Period`}
                          className="text-xl ml-1"
                        />
                      )}
                  </div>
                  {single && <p className={`mt-1 text-sm ${highlighted ? 'text-gray-400' : 'text-gray-500'}`}>{t('pk_total_sessions').replace('{n}', quote.sessions)}</p>}
                  {single && pack.price_per_pack != null && <p className={`mt-1 text-sm ${highlighted ? 'text-gray-400' : 'text-gray-500'}`}>{t('st_pack_total').replace('{price}', formatMoney(quote.total))}</p>}
                  {sessionType === 'dual' && <p className={`mt-1 text-sm ${highlighted ? 'text-gray-400' : 'text-gray-500'}`}>{t('st_price_both')}</p>}
                  {failed && <p className="mt-1 text-sm text-red-500">{t('st_price_error')}</p>}
                </div>

                {own && (
                  <EditableText
                    as="p"
                    path={`sections.${sectionId}.plans.${index}.description`}
                    styleObj={`sections.${sectionId}.plans.${index}.descriptionStyle`}
                    label={`Plan ${index + 1} Description`}
                    style={{ fontFamily: theme.typography.bodyFont }}
                    className={`leading-7 mb-8 block ${highlighted ? 'text-gray-300' : 'text-gray-600'}`}
                  />
                )}

                <ul className={`space-y-3 mb-8 ${highlighted ? 'text-gray-300' : 'text-gray-700'}`}>
                  {(plan.features || []).map((_feature, featureIndex) => (
                    <li key={featureIndex} className="flex gap-2">
                      <span aria-hidden="true">{'\u2713'}</span>
                      <EditableText
                        as="span"
                        path={`sections.${sectionId}.plans.${index}.features.${featureIndex}`}
                        label={`Plan ${index + 1} Feature ${featureIndex + 1}`}
                        style={{ fontFamily: theme.typography.bodyFont }}
                      />
                    </li>
                  ))}
                </ul>

                {own ? (
                  <EditableText
                    as="button"
                    path={`sections.${sectionId}.plans.${index}.buttonText`}
                    styleObj={`sections.${sectionId}.plans.${index}.buttonTextStyle`}
                    label={`Plan ${index + 1} Button`}
                    style={{ fontFamily: theme.typography.accentFont }}
                    className={`border px-6 py-3 uppercase text-sm tracking-[3px] transition duration-300 ${
                      highlighted
                        ? 'border-white hover:bg-white hover:text-black'
                        : 'border-black hover:bg-black hover:text-white'
                    }`}
                  />
                ) : (
                  <button
                    type="button"
                    style={{ fontFamily: theme.typography.accentFont }}
                    className={`border px-6 py-3 uppercase text-sm tracking-[3px] transition duration-300 ${
                      highlighted ? 'border-white hover:bg-white hover:text-black' : 'border-black hover:bg-black hover:text-white'
                    }`}
                  >
                    {resolveText(plan.buttonText, language)}
                  </button>
                )}
              </div>
            )
          })}

        </div>

      </div>

    </section>
  )
}

export default Pricing
