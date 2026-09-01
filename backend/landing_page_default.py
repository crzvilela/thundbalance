# Mirrors src/content/defaultContent.js. Keep both in sync whenever a field
# is added/removed/renamed.


def _text_style(**overrides):
    """Shared shape for every text element's companion 'Style' object.
    Defaults are '' (empty string), meaning 'don't override the Tailwind
    value' — see buildInlineStyle() in Editable.jsx on the frontend."""
    style = {
        "fontSize": "",
        "color": "",
        "marginTop": "",
        "marginBottom": "",
        "marginLeft": "",
        "marginRight": "",
        "padding": "",
        "textAlign": ""
    }
    style.update(overrides)
    return style


def _image_style(**overrides):
    """Shared shape for an editable image's companion 'Style' object."""
    style = {
        "marginTop": "",
        "marginBottom": "",
        "borderRadius": ""
    }
    style.update(overrides)
    return style


def _video_object(**overrides):
    """Shared shape for a video slot's stored value (background video or a
    content video slot). Mirrors defaultContent.js's videoObject()."""
    video = {
        "sourceType": "upload",
        "url": "",
        "autoplay": True,
        "loop": True,
        "muted": True
    }
    video.update(overrides)
    return video


def _section_background(**overrides):
    """Shared shape for every section's background: solid color, image, or
    video (background.type decides which). Defaults keep every section
    visually identical to today (type='color', color='' means 'don't
    override the Tailwind bg-* class'; overlayOpacity defaults to 0 unless a
    section overrides it, like Hero does).
    """
    style = {
        "type": "color",
        "color": "",
        "image": None,
        "position": "center",
        "overlayColor": "#000000",
        "overlayOpacity": 0,
        "video": _video_object()
    }
    style.update(overrides)
    return style


def make_default_service_item():
    """Template used when the admin adds a new Service card from the editor."""
    return {
        "title": "New Service",
        "titleStyle": _text_style(),
        "description": "Describe this service.",
        "descriptionStyle": _text_style(),
        "image": None,
        "imageStyle": _image_style()
    }


def make_default_pricing_plan():
    """Template used when the admin adds a new Pricing plan from the editor."""
    return {
        "name": "New Plan",
        "nameStyle": _text_style(),
        "price": "\u20ac0",
        "priceStyle": _text_style(),
        "period": "/session",
        "periodStyle": _text_style(),
        "description": "Describe this plan.",
        "descriptionStyle": _text_style(),
        "features": ["Feature one"],
        "buttonText": "Get Started",
        "buttonTextStyle": _text_style(),
        "highlighted": False
    }


DEFAULT_LANDING_CONTENT = {
    "theme": {
        "colors": {
            "primary": "#ffffff",
            "secondary": "#000000",
            "background": "#000000",
            "text": "#ffffff",
            "accent": "#22c55e",
            "buttonBg": "transparent",
            "buttonText": "#ffffff",
            "border": "rgba(255,255,255,0.15)"
        },
        "typography": {
            "headingFont": "Bebas Neue",
            "bodyFont": "inherit",
            "buttonSize": "0.875rem"
        }
    },
    "sectionOrder": ["about", "services", "pricing", "testimonials", "contact"],
    "sections": {
        "navbar": {
            "visible": True,
            "brand": "THUNDBALANCE",
            "brandStyle": _text_style(),
            "logoImage": None,
            "showBrandText": True,
            "background": _section_background()
        },
        "hero": {
            "visible": True,
            "eyebrow": "Private Fitness Studio",
            "eyebrowStyle": _text_style(),
            "title": "Transform Your Body And Performance",
            "titleStyle": _text_style(
                fontWeight="700",
                letterSpacing="",
                lineHeight="",
                textAlign="center"
            ),
            "subtitle": "Personalized 1:1 training sessions focused on performance, health, rehabilitation and real results.",
            "subtitleStyle": _text_style(),
            "button": {
                "text": "BOOK A TRIAL SESSION",
                "link": "/trial-session",
                "bgColor": "transparent",
                "textColor": "#ffffff",
                "borderColor": "#ffffff",
                "radius": "0px"
            },
            "background": _section_background(overlayOpacity=0.6)
        },
        "about": {
            "type": "about",
            "visible": True,
            "eyebrow": "About Us",
            "eyebrowStyle": _text_style(),
            "title": "Private Training Focused On Real Results",
            "titleStyle": _text_style(),
            "body": "ThundBalance is a private fitness studio focused on personalized 1:1 and dual training sessions. Every client receives individual support, training plans, nutritional guidance and body metrics monitoring in an exclusive and professional environment.",
            "bodyStyle": _text_style(),
            "image": None,
            "imageStyle": _image_style(),
            "background": _section_background(color="#ffffff"),
            "textColor": "#000000"
        },
        "services": {
            "type": "services",
            "visible": True,
            "eyebrow": "Services",
            "eyebrowStyle": _text_style(),
            "title": "Personalized Training Experience",
            "titleStyle": _text_style(),
            "background": _section_background(),
            "items": [
                {
                    "title": "1:1 Training",
                    "titleStyle": _text_style(),
                    "description": "Individual sessions fully focused on your goals, performance and physical condition.",
                    "descriptionStyle": _text_style(),
                    "image": None,
                    "imageStyle": _image_style()
                },
                {
                    "title": "Dual Sessions",
                    "titleStyle": _text_style(),
                    "description": "Train together with a partner while maintaining personalized coaching and guidance.",
                    "descriptionStyle": _text_style(),
                    "image": None,
                    "imageStyle": _image_style()
                },
                {
                    "title": "Nutrition & Metrics",
                    "titleStyle": _text_style(),
                    "description": "Training plans, nutritional guidance and body metrics tracking included in every program.",
                    "descriptionStyle": _text_style(),
                    "image": None,
                    "imageStyle": _image_style()
                }
            ]
        },
        "pricing": {
            "type": "pricing",
            "visible": True,
            "eyebrow": "Pricing",
            "eyebrowStyle": _text_style(),
            "title": "Training Packages",
            "titleStyle": _text_style(),
            "background": _section_background(),
            "plans": [
                {
                    "name": "Monthly Plan",
                    "nameStyle": _text_style(),
                    "price": "\u20ac65",
                    "priceStyle": _text_style(),
                    "period": "/session",
                    "periodStyle": _text_style(),
                    "description": "Includes 1 to 5 training sessions per week with full coaching support.",
                    "descriptionStyle": _text_style(),
                    "features": ["1-5 sessions per week", "Personal Training", "Flexible Scheduling"],
                    "buttonText": "Get Started",
                    "buttonTextStyle": _text_style(),
                    "highlighted": False
                },
                {
                    "name": "Quarterly Plan",
                    "nameStyle": _text_style(),
                    "price": "\u20ac60",
                    "priceStyle": _text_style(),
                    "period": "/session",
                    "periodStyle": _text_style(),
                    "description": "Designed for long-term progress with training and nutrition follow-up.",
                    "descriptionStyle": _text_style(),
                    "features": [
                        "1-5 sessions per week",
                        "1 Body Metrics Assessment",
                        "3 Training Plan Reviews",
                        "3 Nutrition Plan Reviews"
                    ],
                    "buttonText": "Most Popular",
                    "buttonTextStyle": _text_style(),
                    "highlighted": True
                },
                {
                    "name": "Semiannual Plan",
                    "nameStyle": _text_style(),
                    "price": "\u20ac55",
                    "priceStyle": _text_style(),
                    "period": "/session",
                    "periodStyle": _text_style(),
                    "description": "The most complete package for maximum results and continuous monitoring.",
                    "descriptionStyle": _text_style(),
                    "features": [
                        "1-5 sessions per week",
                        "2 Body Metrics Assessments",
                        "6 Training Plan Reviews",
                        "6 Nutrition Plan Reviews",
                        "1 Personal Consultation"
                    ],
                    "buttonText": "Best Value",
                    "buttonTextStyle": _text_style(),
                    "highlighted": False
                }
            ]
        },
        "testimonials": {
            "type": "testimonials",
            "visible": True,
            "eyebrow": "Testimonials",
            "eyebrowStyle": _text_style(),
            "title": "Real Experiences",
            "titleStyle": _text_style(),
            "background": _section_background()
        },
        "contact": {
            "type": "contact",
            "visible": True,
            "eyebrow": "Contact",
            "eyebrowStyle": _text_style(),
            "title": "Start Your Transformation",
            "titleStyle": _text_style(),
            "body": "Book your first session and discover a personalized training experience focused on real results.",
            "bodyStyle": _text_style(),
            "image": None,
            "imageStyle": _image_style(),
            "background": _section_background()
        },
        "footer": {
            "visible": True,
            "brand": "THUNDBALANCE",
            "brandStyle": _text_style(),
            "text": "\u00a9 2026 ThundBalance. All rights reserved.",
            "textStyle": _text_style(),
            "logoImage": None,
            "showBrandText": True,
            "background": _section_background()
        }
    }
}
