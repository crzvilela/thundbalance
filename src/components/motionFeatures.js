// The animation features of framer-motion, loaded AFTER the first paint (LazyMotion in AppRoutes): the landing page does not wait for them.
// domAnimation = animations, variants, exit animations, hover / tap / focus and whileInView. Nothing here is used by the first screen.
export { domAnimation as default } from 'framer-motion'
