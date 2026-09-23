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


def _ml(en, es, ca):
    """Shorthand for a multilingual text field: {en, es, ca}. Mirrors
    defaultContent.js's ml(). Used only for real editable text (titles, body
    copy, button labels, feature bullets, labels like '/session') — never
    for colors, URLs, image paths, emails, phone numbers or proper nouns
    like the brand name, which are the same in every language. Resolved at
    render time by the frontend's resolveText() (src/utils/multilingual.js).
    """
    return {"en": en, "es": es, "ca": ca}


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
        "period": _ml("/session", "/sesi\u00f3n", "/sessi\u00f3"),
        "periodStyle": _text_style(),
        "description": "Describe this plan.",
        "descriptionStyle": _text_style(),
        "features": [_ml("Feature one", "Caracter\u00edstica uno", "Caracter\u00edstica u")],
        "buttonText": "Get Started",
        "buttonTextStyle": _text_style(),
        "highlighted": False
    }


def make_default_testimonial_media(media_type="image"):
    """Template used when the admin adds a new Testimonials media item
    (client photo or video) from the editor."""
    return {
        "type": media_type,
        "url": "",
        "videoSourceType": "upload" if media_type == "video" else "",
        "clientName": "",
        "caption": ""
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
            "headingFont": "Aldrich",
            "bodyFont": "Inter",
            "accentFont": "Roboto",
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
            "eyebrow": _ml("Private Fitness Studio", "Estudio de Fitness Privado", "Estudi de Fitness Privat"),
            "eyebrowStyle": _text_style(),
            "title": _ml("Transform Your Body And Performance", "Transforma Tu Cuerpo Y Rendimiento", "Transforma El Teu Cos I Rendiment"),
            "titleStyle": _text_style(
                fontWeight="700",
                letterSpacing="",
                lineHeight="",
                textAlign="center"
            ),
            "subtitle": _ml(
                "Personalized 1:1 training sessions focused on performance, health, rehabilitation and real results.",
                "Sesiones de entrenamiento personalizado 1 a 1 centradas en el rendimiento, la salud, la rehabilitaci\u00f3n y resultados reales.",
                "Sessions d'entrenament personalitzat 1 a 1 centrades en el rendiment, la salut, la rehabilitaci\u00f3 i resultats reals."
            ),
            "subtitleStyle": _text_style(),
            "button": {
                "text": _ml("BOOK A TRIAL SESSION", "RESERVA UNA SESI\u00d3N DE PRUEBA", "RESERVA UNA SESSI\u00d3 DE PROVA"),
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
            "eyebrow": _ml("About Us", "Sobre Nosotros", "Sobre Nosaltres"),
            "eyebrowStyle": _text_style(),
            "title": _ml("Private Training Focused On Real Results", "Entrenamiento Privado Centrado En Resultados Reales", "Entrenament Privat Centrat En Resultats Reals"),
            "titleStyle": _text_style(),
            "body": _ml(
                "ThundBalance is a private fitness studio focused on personalized 1:1 and dual training sessions. Every client receives individual support, training plans, nutritional guidance and body metrics monitoring in an exclusive and professional environment.",
                "ThundBalance es un estudio de fitness privado centrado en sesiones de entrenamiento personalizado 1 a 1 y en pareja. Cada cliente recibe apoyo individual, planes de entrenamiento, orientaci\u00f3n nutricional y seguimiento de m\u00e9tricas corporales en un entorno exclusivo y profesional.",
                "ThundBalance \u00e9s un estudi de fitness privat centrat en sessions d'entrenament personalitzat 1 a 1 i en parella. Cada client rep suport individual, plans d'entrenament, orientaci\u00f3 nutricional i seguiment de m\u00e8triques corporals en un entorn exclusiu i professional."
            ),
            "bodyStyle": _text_style(),
            "image": None,
            "imageStyle": _image_style(),
            "embed360Url": "https://www.google.com/maps?layer=c&cbll=41.404704,2.2027016&cbp=12,255.85,0,0,-38.06&output=svembed",
            "carousel": [],
            "background": _section_background(color="#ffffff"),
            "textColor": "#000000"
        },
        "services": {
            "type": "services",
            "visible": True,
            "eyebrow": _ml("Services", "Servicios", "Serveis"),
            "eyebrowStyle": _text_style(),
            "title": _ml("Personalized Training Experience", "Experiencia De Entrenamiento Personalizado", "Experi\u00e8ncia D'Entrenament Personalitzat"),
            "titleStyle": _text_style(),
            "background": _section_background(),
            "items": [
                {
                    "title": _ml("1:1 Training", "Entrenamiento 1 a 1", "Entrenament 1 a 1"),
                    "titleStyle": _text_style(),
                    "description": _ml(
                        "Individual sessions fully focused on your goals, performance and physical condition.",
                        "Sesiones individuales totalmente centradas en tus objetivos, rendimiento y condici\u00f3n f\u00edsica.",
                        "Sessions individuals totalment centrades en els teus objectius, rendiment i condici\u00f3 f\u00edsica."
                    ),
                    "descriptionStyle": _text_style(),
                    "image": None,
                    "imageStyle": _image_style()
                },
                {
                    "title": _ml("Dual Sessions", "Sesiones En Pareja", "Sessions En Parella"),
                    "titleStyle": _text_style(),
                    "description": _ml(
                        "Train together with a partner while maintaining personalized coaching and guidance.",
                        "Entrena junto a un compa\u00f1ero manteniendo un coaching y una orientaci\u00f3n personalizados.",
                        "Entrena juntament amb un company mantenint un coaching i una orientaci\u00f3 personalitzats."
                    ),
                    "descriptionStyle": _text_style(),
                    "image": None,
                    "imageStyle": _image_style()
                },
                {
                    "title": _ml("Nutrition & Metrics", "Nutrici\u00f3n Y M\u00e9tricas", "Nutrici\u00f3 I M\u00e8triques"),
                    "titleStyle": _text_style(),
                    "description": _ml(
                        "Training plans, nutritional guidance and body metrics tracking included in every program.",
                        "Planes de entrenamiento, orientaci\u00f3n nutricional y seguimiento de m\u00e9tricas corporales incluidos en cada programa.",
                        "Plans d'entrenament, orientaci\u00f3 nutricional i seguiment de m\u00e8triques corporals inclosos a cada programa."
                    ),
                    "descriptionStyle": _text_style(),
                    "image": None,
                    "imageStyle": _image_style()
                }
            ]
        },
        "pricing": {
            "type": "pricing",
            "visible": True,
            "eyebrow": _ml("Pricing", "Precios", "Preus"),
            "eyebrowStyle": _text_style(),
            "title": _ml("Training Packages", "Paquetes De Entrenamiento", "Paquets D'Entrenament"),
            "titleStyle": _text_style(),
            "background": _section_background(),
            "plans": [
                {
                    "name": _ml("Monthly Plan", "Plan Mensual", "Pla Mensual"),
                    "nameStyle": _text_style(),
                    "price": "\u20ac65",
                    "priceStyle": _text_style(),
                    "period": _ml("/session", "/sesi\u00f3n", "/sessi\u00f3"),
                    "periodStyle": _text_style(),
                    "description": _ml(
                        "Includes 1 to 5 training sessions per week with full coaching support.",
                        "Incluye de 1 a 5 sesiones de entrenamiento por semana con apoyo completo de coaching.",
                        "Inclou d'1 a 5 sessions d'entrenament per setmana amb suport complet de coaching."
                    ),
                    "descriptionStyle": _text_style(),
                    "features": [
                        _ml("1-5 sessions per week", "De 1 a 5 sesiones por semana", "D'1 a 5 sessions per setmana"),
                        _ml("Personal Training", "Entrenamiento Personal", "Entrenament Personal"),
                        _ml("Flexible Scheduling", "Horario Flexible", "Horari Flexible")
                    ],
                    "buttonText": _ml("Get Started", "Empezar", "Comen\u00e7ar"),
                    "buttonTextStyle": _text_style(),
                    "highlighted": False
                },
                {
                    "name": _ml("Quarterly Plan", "Plan Trimestral", "Pla Trimestral"),
                    "nameStyle": _text_style(),
                    "price": "\u20ac60",
                    "priceStyle": _text_style(),
                    "period": _ml("/session", "/sesi\u00f3n", "/sessi\u00f3"),
                    "periodStyle": _text_style(),
                    "description": _ml(
                        "Designed for long-term progress with training and nutrition follow-up.",
                        "Dise\u00f1ado para un progreso a largo plazo con seguimiento de entrenamiento y nutrici\u00f3n.",
                        "Dissenyat per a un progr\u00e9s a llarg termini amb seguiment d'entrenament i nutrici\u00f3."
                    ),
                    "descriptionStyle": _text_style(),
                    "features": [
                        _ml("1-5 sessions per week", "De 1 a 5 sesiones por semana", "D'1 a 5 sessions per setmana"),
                        _ml("1 Body Metrics Assessment", "1 Evaluaci\u00f3n de M\u00e9tricas Corporales", "1 Avaluaci\u00f3 de M\u00e8triques Corporals"),
                        _ml("3 Training Plan Reviews", "3 Revisiones del Plan de Entrenamiento", "3 Revisions del Pla d'Entrenament"),
                        _ml("3 Nutrition Plan Reviews", "3 Revisiones del Plan de Nutrici\u00f3n", "3 Revisions del Pla de Nutrici\u00f3")
                    ],
                    "buttonText": _ml("Most Popular", "M\u00e1s Popular", "M\u00e9s Popular"),
                    "buttonTextStyle": _text_style(),
                    "highlighted": True
                },
                {
                    "name": _ml("Semiannual Plan", "Plan Semestral", "Pla Semestral"),
                    "nameStyle": _text_style(),
                    "price": "\u20ac55",
                    "priceStyle": _text_style(),
                    "period": _ml("/session", "/sesi\u00f3n", "/sessi\u00f3"),
                    "periodStyle": _text_style(),
                    "description": _ml(
                        "The most complete package for maximum results and continuous monitoring.",
                        "El paquete m\u00e1s completo para obtener el m\u00e1ximo resultado y un seguimiento continuo.",
                        "El paquet m\u00e9s complet per obtenir el m\u00e0xim resultat i un seguiment continu."
                    ),
                    "descriptionStyle": _text_style(),
                    "features": [
                        _ml("1-5 sessions per week", "De 1 a 5 sesiones por semana", "D'1 a 5 sessions per setmana"),
                        _ml("2 Body Metrics Assessments", "2 Evaluaciones de M\u00e9tricas Corporales", "2 Avaluacions de M\u00e8triques Corporals"),
                        _ml("6 Training Plan Reviews", "6 Revisiones del Plan de Entrenamiento", "6 Revisions del Pla d'Entrenament"),
                        _ml("6 Nutrition Plan Reviews", "6 Revisiones del Plan de Nutrici\u00f3n", "6 Revisions del Pla de Nutrici\u00f3"),
                        _ml("1 Personal Consultation", "1 Consulta Personal", "1 Consulta Personal")
                    ],
                    "buttonText": _ml("Best Value", "Mejor Valor", "Millor Valor"),
                    "buttonTextStyle": _text_style(),
                    "highlighted": False
                }
            ]
        },
        "testimonials": {
            "type": "testimonials",
            "visible": True,
            "eyebrow": _ml("Testimonials", "Testimonios", "Testimonis"),
            "eyebrowStyle": _text_style(),
            "title": _ml("Real Experiences", "Experiencias Reales", "Experi\u00e8ncies Reals"),
            "titleStyle": _text_style(),
            "background": _section_background(),
            "media": []
        },
        "contact": {
            "type": "contact",
            "visible": True,
            "eyebrow": _ml("Contact", "Contacto", "Contacte"),
            "eyebrowStyle": _text_style(),
            "title": _ml("Start Your Transformation", "Comienza Tu Transformaci\u00f3n", "Comen\u00e7a La Teva Transformaci\u00f3"),
            "titleStyle": _text_style(),
            "body": _ml(
                "Book your first session and discover a personalized training experience focused on real results.",
                "Reserva tu primera sesi\u00f3n y descubre una experiencia de entrenamiento personalizado centrada en resultados reales.",
                "Reserva la teva primera sessi\u00f3 i descobreix una experi\u00e8ncia d'entrenament personalitzat centrada en resultats reals."
            ),
            "bodyStyle": _text_style(),
            "image": None,
            "imageStyle": _image_style(),
            "background": _section_background()
        },
        "footer": {
            "visible": True,
            "brand": "THUNDBALANCE",
            "brandStyle": _text_style(),
            "text": _ml(
                "\u00a9 2026 ThundBalance. All rights reserved.",
                "\u00a9 2026 ThundBalance. Todos los derechos reservados.",
                "\u00a9 2026 ThundBalance. Tots els drets reservats."
            ),
            "textStyle": _text_style(),
            "logoImage": None,
            "showBrandText": True,
            "background": _section_background(),
            "address": {
                "text": _ml(
                    "Carrer de Pallars, 286, Sant Mart\u00ed, 08005 Barcelona, Spain",
                    "Carrer de Pallars, 286, Sant Mart\u00ed, 08005 Barcelona, Espa\u00f1a",
                    "Carrer de Pallars, 286, Sant Mart\u00ed, 08005 Barcelona, Espanya"
                ),
                "mapsLink": "https://www.google.com/maps/place//data=!4m2!3m1!1s0x12a4a385af63a49b:0x841dd304c428a382?sa=X&ved=1t:8290&ictx=111"
            },
            "mapEmbedUrl": "https://www.google.com/maps?q=Carrer+de+Pallars+286+Barcelona&output=embed",
            "streetView360EmbedUrl": "",
            "contactUsUrl": "https://www.thundbalance.com/contactus",
            "joinUsEmail": "mailto:info@thundbalance.com?subject=I%20am%20interested%20to%20join%20TB%20team",
            "contactEmail": "info@thundbalance.com",
            "whatsappNumber": "+34 617 21 33 60",
            "whatsappLink": "https://wa.me/+34617213360",
            "instagramUrl": "https://www.instagram.com/thundbalance"
        }
    }
}
