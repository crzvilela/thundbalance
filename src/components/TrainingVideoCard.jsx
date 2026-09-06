import TrainingVideoPlayer from './TrainingVideoPlayer'

// One card in the public Training Tips grid. The description always shows
// in full — the card simply grows taller to fit it. `items-start` on the
// grid (see TrainingTips.jsx) keeps each card's height independent, so a
// long description here doesn't stretch its neighbors.
//
// `min-w-0` on the root is essential: grid/flex items default to
// `min-width: auto`, which lets long unbroken text (e.g. a run of
// characters with no spaces) push the card wider than its column instead of
// wrapping. `[overflow-wrap:anywhere]` on the text itself then does the
// actual wrapping — it behaves like break-words for normal text (still
// prefers breaking at spaces) but, unlike break-words, also forces a
// mid-word break when a single "word" has nowhere else to break, which is
// exactly the no-spaces case that was overflowing. `overflow-hidden` on the
// root is a belt-and-suspenders guard against any remaining overflow.
function TrainingVideoCard({ video }) {
  return (
    <div className="border border-white/10 p-6 flex flex-col gap-4 items-start w-full min-w-0 overflow-hidden hover:border-white transition duration-500">
      <TrainingVideoPlayer source={video.video_source} url={video.video_url} className="w-full" />

      <h3 className="text-2xl uppercase tracking-wide w-full [overflow-wrap:anywhere]">
        {video.title}
      </h3>

      {video.description && (
        <p className="text-gray-400 leading-7 w-full whitespace-pre-line [overflow-wrap:anywhere]">
          {video.description}
        </p>
      )}
    </div>
  )
}

export default TrainingVideoCard
