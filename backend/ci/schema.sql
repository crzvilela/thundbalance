--
-- PostgreSQL database dump
--

\restrict Mbor7GyAlK5EhmW9o6aUuYkYDY9gjcZkTn93GSodfzZowep2bSfh8hhBPSVIKbA

-- Dumped from database version 18.4
-- Dumped by pg_dump version 18.4

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: admin_audit_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.admin_audit_log (
    id integer NOT NULL,
    at timestamp without time zone DEFAULT (now() AT TIME ZONE 'UTC'::text) NOT NULL,
    admin_uid text,
    action text NOT NULL,
    client_id integer,
    outcome text NOT NULL,
    detail text
);


--
-- Name: admin_audit_log_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.admin_audit_log_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: admin_audit_log_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.admin_audit_log_id_seq OWNED BY public.admin_audit_log.id;


--
-- Name: admin_ui_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.admin_ui_settings (
    key text NOT NULL,
    value jsonb NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_by integer
);


--
-- Name: app_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.app_settings (
    key text NOT NULL,
    value text NOT NULL
);


--
-- Name: client_erasure_pending; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.client_erasure_pending (
    client_id integer NOT NULL,
    stopped_at text NOT NULL,
    error_type text,
    attempts integer DEFAULT 1 NOT NULL,
    first_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: client_requests; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.client_requests (
    id integer NOT NULL,
    user_id integer,
    plan_id integer,
    sessions_per_week integer,
    preferred_days character varying(255),
    preferred_time character varying(20),
    status character varying(50) DEFAULT 'Pending'::character varying,
    start_date date,
    trainer_id integer,
    rejection_reason text,
    archived_at timestamp without time zone,
    session_type text DEFAULT 'individual'::text NOT NULL,
    second_person_name text,
    second_person_email text,
    created_at timestamp without time zone DEFAULT (now() AT TIME ZONE 'UTC'::text),
    catalog_pack_id integer,
    schedule jsonb
);


--
-- Name: client_requests_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.client_requests_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: client_requests_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.client_requests_id_seq OWNED BY public.client_requests.id;


--
-- Name: contact_message_audit; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.contact_message_audit (
    id integer NOT NULL,
    action text NOT NULL,
    amount integer NOT NULL,
    admin_email text,
    created_at timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: contact_message_audit_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.contact_message_audit_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: contact_message_audit_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.contact_message_audit_id_seq OWNED BY public.contact_message_audit.id;


--
-- Name: contact_messages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.contact_messages (
    id integer NOT NULL,
    name text NOT NULL,
    email text NOT NULL,
    message text NOT NULL,
    language text,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    read_at timestamp without time zone,
    archived_at timestamp without time zone,
    phone text,
    subject text
);


--
-- Name: contact_messages_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.contact_messages_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: contact_messages_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.contact_messages_id_seq OWNED BY public.contact_messages.id;


--
-- Name: deletion_requests; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.deletion_requests (
    id integer NOT NULL,
    user_id integer NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    handled_by text,
    handled_at timestamp without time zone,
    reason text
);


--
-- Name: deletion_requests_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.deletion_requests_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: deletion_requests_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.deletion_requests_id_seq OWNED BY public.deletion_requests.id;


--
-- Name: email_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.email_log (
    id integer NOT NULL,
    tipo text NOT NULL,
    referencia text,
    destinatario text NOT NULL,
    estado text NOT NULL,
    erro text,
    criado_em timestamp without time zone DEFAULT (now() AT TIME ZONE 'UTC'::text) NOT NULL,
    lang text
);


--
-- Name: email_log_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.email_log_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: email_log_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.email_log_id_seq OWNED BY public.email_log.id;


--
-- Name: inbox_audit; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.inbox_audit (
    id integer NOT NULL,
    action text NOT NULL,
    message_id integer,
    admin_email text,
    created_at timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: inbox_audit_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.inbox_audit_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: inbox_audit_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.inbox_audit_id_seq OWNED BY public.inbox_audit.id;


--
-- Name: inbox_messages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.inbox_messages (
    id integer NOT NULL,
    kind text NOT NULL,
    type text NOT NULL,
    title text,
    body text,
    translations jsonb,
    main_lang text,
    audience text,
    action_label text,
    action_target text,
    template_key text,
    params jsonb,
    refs jsonb,
    dedupe_key text,
    visible_from timestamp without time zone NOT NULL,
    expires_at timestamp without time zone,
    created_by text,
    idempotency_key text,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    deleted_at timestamp without time zone,
    archived_at timestamp without time zone,
    archived_by text,
    audiences jsonb
);


--
-- Name: inbox_messages_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.inbox_messages_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: inbox_messages_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.inbox_messages_id_seq OWNED BY public.inbox_messages.id;


--
-- Name: inbox_recipients; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.inbox_recipients (
    id integer NOT NULL,
    message_id integer NOT NULL,
    user_id integer,
    recipient_email text NOT NULL,
    read_at timestamp without time zone,
    deleted_at timestamp without time zone,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    archived_at timestamp without time zone,
    source text
);


--
-- Name: inbox_recipients_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.inbox_recipients_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: inbox_recipients_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.inbox_recipients_id_seq OWNED BY public.inbox_recipients.id;


--
-- Name: landing_page_content; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.landing_page_content (
    id integer NOT NULL,
    version text NOT NULL,
    content jsonb NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: landing_page_content_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.landing_page_content_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: landing_page_content_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.landing_page_content_id_seq OWNED BY public.landing_page_content.id;


--
-- Name: pack_catalog; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pack_catalog (
    id integer NOT NULL,
    name text NOT NULL,
    session_type text NOT NULL,
    weeks integer NOT NULL,
    sessions_per_week_options integer[] NOT NULL,
    price_per_session numeric(10,2) NOT NULL,
    price_per_pack numeric(10,2),
    plan_id integer,
    active boolean DEFAULT true NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    archived_at timestamp without time zone,
    objective text,
    benefits jsonb
);


--
-- Name: pack_catalog_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.pack_catalog_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: pack_catalog_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.pack_catalog_id_seq OWNED BY public.pack_catalog.id;


--
-- Name: plans; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.plans (
    id integer NOT NULL,
    nome character varying(100) NOT NULL,
    duracao_meses integer NOT NULL,
    preco_sessao numeric(10,2) NOT NULL,
    duration_weeks integer
);


--
-- Name: plans_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.plans_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: plans_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.plans_id_seq OWNED BY public.plans.id;


--
-- Name: pricing; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pricing (
    kind text NOT NULL,
    session_type text NOT NULL,
    months integer NOT NULL,
    price numeric(10,2) NOT NULL
);


--
-- Name: rate_limit_hits; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.rate_limit_hits (
    id bigint NOT NULL,
    bucket text NOT NULL,
    key text NOT NULL,
    hit_at timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: rate_limit_hits_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.rate_limit_hits_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: rate_limit_hits_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.rate_limit_hits_id_seq OWNED BY public.rate_limit_hits.id;


--
-- Name: reschedule_requests; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.reschedule_requests (
    id integer NOT NULL,
    session_id integer NOT NULL,
    user_id integer NOT NULL,
    original_date date NOT NULL,
    original_time time without time zone NOT NULL,
    requested_date date NOT NULL,
    requested_time time without time zone NOT NULL,
    client_note text,
    status text DEFAULT 'pending'::text NOT NULL,
    admin_note text,
    counter_date date,
    counter_time time without time zone,
    decided_by text,
    decided_at timestamp without time zone,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    token text NOT NULL,
    lang text,
    counter_late boolean DEFAULT false NOT NULL,
    requested_trainer_id integer,
    extra_emails text[]
);


--
-- Name: reschedule_requests_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.reschedule_requests_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: reschedule_requests_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.reschedule_requests_id_seq OWNED BY public.reschedule_requests.id;


--
-- Name: sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sessions (
    id integer NOT NULL,
    user_id integer NOT NULL,
    trainer_id integer,
    session_date date NOT NULL,
    session_time time without time zone NOT NULL,
    status character varying(50) DEFAULT 'Booked'::character varying,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    google_event_id character varying(255),
    session_number text,
    rescheduled boolean DEFAULT false,
    request_id integer,
    user_plan_id integer,
    calendar_sync_status text,
    calendar_sync_error text,
    feed_sequence integer DEFAULT 0 NOT NULL,
    cancelled_at timestamp without time zone,
    cancelled_by text,
    restored_at timestamp without time zone,
    restored_by text,
    cancel_source text
);


--
-- Name: sessions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.sessions_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: sessions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.sessions_id_seq OWNED BY public.sessions.id;


--
-- Name: trainer_access; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.trainer_access (
    id integer NOT NULL,
    trainer_id integer NOT NULL,
    firebase_uid text,
    email text NOT NULL,
    granted_by text,
    granted_at timestamp without time zone DEFAULT (now() AT TIME ZONE 'UTC'::text) NOT NULL,
    revoked_at timestamp without time zone
);


--
-- Name: trainer_access_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.trainer_access_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: trainer_access_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.trainer_access_id_seq OWNED BY public.trainer_access.id;


--
-- Name: trainer_access_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.trainer_access_log (
    id integer NOT NULL,
    action text NOT NULL,
    trainer_id integer,
    email text,
    admin_uid text,
    created_at timestamp without time zone DEFAULT (now() AT TIME ZONE 'UTC'::text) NOT NULL
);


--
-- Name: trainer_access_log_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.trainer_access_log_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: trainer_access_log_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.trainer_access_log_id_seq OWNED BY public.trainer_access_log.id;


--
-- Name: trainer_availability; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.trainer_availability (
    id integer NOT NULL,
    trainer_id integer NOT NULL,
    day_of_week character varying(20) NOT NULL,
    start_time time without time zone NOT NULL,
    end_time time without time zone NOT NULL
);


--
-- Name: trainer_availability_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.trainer_availability_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: trainer_availability_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.trainer_availability_id_seq OWNED BY public.trainer_availability.id;


--
-- Name: trainers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.trainers (
    id integer NOT NULL,
    nome character varying(255) NOT NULL,
    email character varying(255) NOT NULL,
    especialidade character varying(255),
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    active boolean DEFAULT true NOT NULL,
    color text
);


--
-- Name: trainers_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.trainers_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: trainers_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.trainers_id_seq OWNED BY public.trainers.id;


--
-- Name: training_videos; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.training_videos (
    id integer NOT NULL,
    title text NOT NULL,
    description text,
    video_source text NOT NULL,
    video_url text NOT NULL,
    display_order integer DEFAULT 0,
    created_at timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: training_videos_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.training_videos_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: training_videos_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.training_videos_id_seq OWNED BY public.training_videos.id;


--
-- Name: trial_sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.trial_sessions (
    id integer NOT NULL,
    full_name character varying(255) NOT NULL,
    email character varying(255) NOT NULL,
    phone character varying(50),
    age integer,
    goal text,
    experience character varying(100),
    session_date date,
    session_time time without time zone,
    status character varying(50) DEFAULT 'Pending'::character varying,
    created_at timestamp without time zone DEFAULT now(),
    trainer_id integer,
    google_event_id text,
    rejection_reason text,
    birth_date date,
    confirmation_token text,
    approved_at timestamp without time zone,
    confirmed_at timestamp without time zone,
    declined_at timestamp without time zone,
    calendar_error text,
    lang text DEFAULT 'en'::text,
    calendar_sync_status text,
    calendar_sync_error text,
    feed_sequence integer DEFAULT 0 NOT NULL,
    session_type text DEFAULT 'individual'::text NOT NULL,
    second_person_name text,
    second_person_email text,
    price_per_session numeric(10,2),
    extra_emails text[],
    calendar_share boolean DEFAULT false NOT NULL,
    calendar_extra text,
    cancel_source text,
    cancel_prev_status text
);


--
-- Name: trial_sessions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.trial_sessions_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: trial_sessions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.trial_sessions_id_seq OWNED BY public.trial_sessions.id;


--
-- Name: uploaded_files; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.uploaded_files (
    name text NOT NULL,
    content_type text NOT NULL,
    data bytea NOT NULL,
    size integer NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    owner_user_id integer
);


--
-- Name: user_plans; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_plans (
    id integer NOT NULL,
    user_id integer,
    plan_id integer,
    active boolean DEFAULT true NOT NULL,
    start_date date,
    end_date date,
    sessions_per_week integer,
    preferred_days text,
    preferred_time text,
    trainer_id integer,
    session_type text DEFAULT 'individual'::text NOT NULL,
    second_person_name text,
    second_person_email text,
    price_per_session numeric(10,2),
    total_price numeric(10,2),
    status text,
    created_at timestamp without time zone,
    replaced_at timestamp without time zone,
    duration_months integer,
    catalog_pack_id integer,
    weeks integer,
    extra_emails text[],
    calendar_share boolean DEFAULT false NOT NULL,
    calendar_extra text,
    schedule jsonb
);


--
-- Name: user_plans_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.user_plans_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: user_plans_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.user_plans_id_seq OWNED BY public.user_plans.id;


--
-- Name: users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.users (
    id integer NOT NULL,
    firebase_uid character varying(255),
    nome character varying(255) NOT NULL,
    email character varying(255) NOT NULL,
    foto text,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    telefone character varying(30),
    codigo_pais character varying(10),
    cidade character varying(100),
    morada character varying(255),
    cep character varying(30),
    must_change_password boolean DEFAULT false NOT NULL,
    tax_id_type text,
    tax_id text,
    country text,
    archived_at timestamp without time zone,
    calendar_feed_token text,
    lang text
);


--
-- Name: users_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.users_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: users_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.users_id_seq OWNED BY public.users.id;


--
-- Name: admin_audit_log id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admin_audit_log ALTER COLUMN id SET DEFAULT nextval('public.admin_audit_log_id_seq'::regclass);


--
-- Name: client_requests id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.client_requests ALTER COLUMN id SET DEFAULT nextval('public.client_requests_id_seq'::regclass);


--
-- Name: contact_message_audit id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contact_message_audit ALTER COLUMN id SET DEFAULT nextval('public.contact_message_audit_id_seq'::regclass);


--
-- Name: contact_messages id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contact_messages ALTER COLUMN id SET DEFAULT nextval('public.contact_messages_id_seq'::regclass);


--
-- Name: deletion_requests id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.deletion_requests ALTER COLUMN id SET DEFAULT nextval('public.deletion_requests_id_seq'::regclass);


--
-- Name: email_log id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_log ALTER COLUMN id SET DEFAULT nextval('public.email_log_id_seq'::regclass);


--
-- Name: inbox_audit id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inbox_audit ALTER COLUMN id SET DEFAULT nextval('public.inbox_audit_id_seq'::regclass);


--
-- Name: inbox_messages id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inbox_messages ALTER COLUMN id SET DEFAULT nextval('public.inbox_messages_id_seq'::regclass);


--
-- Name: inbox_recipients id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inbox_recipients ALTER COLUMN id SET DEFAULT nextval('public.inbox_recipients_id_seq'::regclass);


--
-- Name: landing_page_content id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.landing_page_content ALTER COLUMN id SET DEFAULT nextval('public.landing_page_content_id_seq'::regclass);


--
-- Name: pack_catalog id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pack_catalog ALTER COLUMN id SET DEFAULT nextval('public.pack_catalog_id_seq'::regclass);


--
-- Name: plans id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.plans ALTER COLUMN id SET DEFAULT nextval('public.plans_id_seq'::regclass);


--
-- Name: rate_limit_hits id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rate_limit_hits ALTER COLUMN id SET DEFAULT nextval('public.rate_limit_hits_id_seq'::regclass);


--
-- Name: reschedule_requests id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reschedule_requests ALTER COLUMN id SET DEFAULT nextval('public.reschedule_requests_id_seq'::regclass);


--
-- Name: sessions id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sessions ALTER COLUMN id SET DEFAULT nextval('public.sessions_id_seq'::regclass);


--
-- Name: trainer_access id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trainer_access ALTER COLUMN id SET DEFAULT nextval('public.trainer_access_id_seq'::regclass);


--
-- Name: trainer_access_log id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trainer_access_log ALTER COLUMN id SET DEFAULT nextval('public.trainer_access_log_id_seq'::regclass);


--
-- Name: trainer_availability id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trainer_availability ALTER COLUMN id SET DEFAULT nextval('public.trainer_availability_id_seq'::regclass);


--
-- Name: trainers id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trainers ALTER COLUMN id SET DEFAULT nextval('public.trainers_id_seq'::regclass);


--
-- Name: training_videos id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.training_videos ALTER COLUMN id SET DEFAULT nextval('public.training_videos_id_seq'::regclass);


--
-- Name: trial_sessions id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trial_sessions ALTER COLUMN id SET DEFAULT nextval('public.trial_sessions_id_seq'::regclass);


--
-- Name: user_plans id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_plans ALTER COLUMN id SET DEFAULT nextval('public.user_plans_id_seq'::regclass);


--
-- Name: users id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users ALTER COLUMN id SET DEFAULT nextval('public.users_id_seq'::regclass);


--
-- Name: admin_audit_log admin_audit_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admin_audit_log
    ADD CONSTRAINT admin_audit_log_pkey PRIMARY KEY (id);


--
-- Name: admin_ui_settings admin_ui_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.admin_ui_settings
    ADD CONSTRAINT admin_ui_settings_pkey PRIMARY KEY (key);


--
-- Name: app_settings app_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_settings
    ADD CONSTRAINT app_settings_pkey PRIMARY KEY (key);


--
-- Name: client_erasure_pending client_erasure_pending_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.client_erasure_pending
    ADD CONSTRAINT client_erasure_pending_pkey PRIMARY KEY (client_id);


--
-- Name: client_requests client_requests_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.client_requests
    ADD CONSTRAINT client_requests_pkey PRIMARY KEY (id);


--
-- Name: contact_message_audit contact_message_audit_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contact_message_audit
    ADD CONSTRAINT contact_message_audit_pkey PRIMARY KEY (id);


--
-- Name: contact_messages contact_messages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contact_messages
    ADD CONSTRAINT contact_messages_pkey PRIMARY KEY (id);


--
-- Name: deletion_requests deletion_requests_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.deletion_requests
    ADD CONSTRAINT deletion_requests_pkey PRIMARY KEY (id);


--
-- Name: email_log email_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_log
    ADD CONSTRAINT email_log_pkey PRIMARY KEY (id);


--
-- Name: inbox_audit inbox_audit_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inbox_audit
    ADD CONSTRAINT inbox_audit_pkey PRIMARY KEY (id);


--
-- Name: inbox_messages inbox_messages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inbox_messages
    ADD CONSTRAINT inbox_messages_pkey PRIMARY KEY (id);


--
-- Name: inbox_recipients inbox_recipients_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inbox_recipients
    ADD CONSTRAINT inbox_recipients_pkey PRIMARY KEY (id);


--
-- Name: landing_page_content landing_page_content_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.landing_page_content
    ADD CONSTRAINT landing_page_content_pkey PRIMARY KEY (id);


--
-- Name: landing_page_content landing_page_content_version_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.landing_page_content
    ADD CONSTRAINT landing_page_content_version_key UNIQUE (version);


--
-- Name: pack_catalog pack_catalog_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pack_catalog
    ADD CONSTRAINT pack_catalog_pkey PRIMARY KEY (id);


--
-- Name: plans plans_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.plans
    ADD CONSTRAINT plans_pkey PRIMARY KEY (id);


--
-- Name: pricing pricing_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pricing
    ADD CONSTRAINT pricing_pkey PRIMARY KEY (kind, session_type, months);


--
-- Name: rate_limit_hits rate_limit_hits_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rate_limit_hits
    ADD CONSTRAINT rate_limit_hits_pkey PRIMARY KEY (id);


--
-- Name: reschedule_requests reschedule_requests_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reschedule_requests
    ADD CONSTRAINT reschedule_requests_pkey PRIMARY KEY (id);


--
-- Name: sessions sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sessions
    ADD CONSTRAINT sessions_pkey PRIMARY KEY (id);


--
-- Name: trainer_access_log trainer_access_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trainer_access_log
    ADD CONSTRAINT trainer_access_log_pkey PRIMARY KEY (id);


--
-- Name: trainer_access trainer_access_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trainer_access
    ADD CONSTRAINT trainer_access_pkey PRIMARY KEY (id);


--
-- Name: trainer_availability trainer_availability_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trainer_availability
    ADD CONSTRAINT trainer_availability_pkey PRIMARY KEY (id);


--
-- Name: trainers trainers_email_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trainers
    ADD CONSTRAINT trainers_email_key UNIQUE (email);


--
-- Name: trainers trainers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trainers
    ADD CONSTRAINT trainers_pkey PRIMARY KEY (id);


--
-- Name: training_videos training_videos_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.training_videos
    ADD CONSTRAINT training_videos_pkey PRIMARY KEY (id);


--
-- Name: trial_sessions trial_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trial_sessions
    ADD CONSTRAINT trial_sessions_pkey PRIMARY KEY (id);


--
-- Name: uploaded_files uploaded_files_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.uploaded_files
    ADD CONSTRAINT uploaded_files_pkey PRIMARY KEY (name);


--
-- Name: user_plans user_plans_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_plans
    ADD CONSTRAINT user_plans_pkey PRIMARY KEY (id);


--
-- Name: users users_email_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_email_key UNIQUE (email);


--
-- Name: users users_firebase_uid_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_firebase_uid_key UNIQUE (firebase_uid);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: contact_messages_archived_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX contact_messages_archived_idx ON public.contact_messages USING btree (archived_at);


--
-- Name: deletion_requests_one_pending; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX deletion_requests_one_pending ON public.deletion_requests USING btree (user_id) WHERE (status = 'pending'::text);


--
-- Name: email_log_ref_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX email_log_ref_idx ON public.email_log USING btree (tipo, referencia, id DESC);


--
-- Name: inbox_messages_archived_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX inbox_messages_archived_idx ON public.inbox_messages USING btree (kind, archived_at);


--
-- Name: inbox_messages_dedupe_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX inbox_messages_dedupe_key ON public.inbox_messages USING btree (dedupe_key);


--
-- Name: inbox_messages_idempotency_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX inbox_messages_idempotency_key ON public.inbox_messages USING btree (idempotency_key);


--
-- Name: inbox_messages_kind_visible_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX inbox_messages_kind_visible_idx ON public.inbox_messages USING btree (kind, visible_from);


--
-- Name: inbox_recipients_email_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX inbox_recipients_email_idx ON public.inbox_recipients USING btree (recipient_email);


--
-- Name: inbox_recipients_message_email_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX inbox_recipients_message_email_key ON public.inbox_recipients USING btree (message_id, recipient_email);


--
-- Name: inbox_recipients_message_user_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX inbox_recipients_message_user_key ON public.inbox_recipients USING btree (message_id, user_id);


--
-- Name: inbox_recipients_user_archived_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX inbox_recipients_user_archived_idx ON public.inbox_recipients USING btree (user_id, archived_at);


--
-- Name: inbox_recipients_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX inbox_recipients_user_idx ON public.inbox_recipients USING btree (user_id);


--
-- Name: inbox_recipients_user_read_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX inbox_recipients_user_read_idx ON public.inbox_recipients USING btree (user_id, read_at);


--
-- Name: rate_limit_hits_lookup; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX rate_limit_hits_lookup ON public.rate_limit_hits USING btree (bucket, key, hit_at);


--
-- Name: reschedule_requests_one_open; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX reschedule_requests_one_open ON public.reschedule_requests USING btree (session_id) WHERE (status = ANY (ARRAY['pending'::text, 'counter_proposed'::text]));


--
-- Name: reschedule_requests_session_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX reschedule_requests_session_idx ON public.reschedule_requests USING btree (session_id);


--
-- Name: reschedule_requests_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX reschedule_requests_status_idx ON public.reschedule_requests USING btree (status);


--
-- Name: reschedule_requests_token_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX reschedule_requests_token_key ON public.reschedule_requests USING btree (token);


--
-- Name: sessions_date_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX sessions_date_idx ON public.sessions USING btree (session_date);


--
-- Name: sessions_trainer_date_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX sessions_trainer_date_idx ON public.sessions USING btree (trainer_id, session_date);


--
-- Name: trainer_access_one_active_per_email; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX trainer_access_one_active_per_email ON public.trainer_access USING btree (email) WHERE (revoked_at IS NULL);


--
-- Name: trainer_access_one_active_per_trainer; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX trainer_access_one_active_per_trainer ON public.trainer_access USING btree (trainer_id) WHERE (revoked_at IS NULL);


--
-- Name: trial_sessions_confirmation_token_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX trial_sessions_confirmation_token_key ON public.trial_sessions USING btree (confirmation_token);


--
-- Name: trial_sessions_date_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX trial_sessions_date_idx ON public.trial_sessions USING btree (session_date);


--
-- Name: uploaded_files_owner; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX uploaded_files_owner ON public.uploaded_files USING btree (owner_user_id);


--
-- Name: users_calendar_feed_token_key; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX users_calendar_feed_token_key ON public.users USING btree (calendar_feed_token);


--
-- Name: client_requests client_requests_plan_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.client_requests
    ADD CONSTRAINT client_requests_plan_id_fkey FOREIGN KEY (plan_id) REFERENCES public.plans(id);


--
-- Name: client_requests client_requests_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.client_requests
    ADD CONSTRAINT client_requests_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: user_plans fk_plan; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_plans
    ADD CONSTRAINT fk_plan FOREIGN KEY (plan_id) REFERENCES public.plans(id);


--
-- Name: sessions fk_trainer; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sessions
    ADD CONSTRAINT fk_trainer FOREIGN KEY (trainer_id) REFERENCES public.trainers(id);


--
-- Name: sessions fk_user; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sessions
    ADD CONSTRAINT fk_user FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: user_plans fk_user; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_plans
    ADD CONSTRAINT fk_user FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: inbox_recipients inbox_recipients_message_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inbox_recipients
    ADD CONSTRAINT inbox_recipients_message_id_fkey FOREIGN KEY (message_id) REFERENCES public.inbox_messages(id) ON DELETE CASCADE;


--
-- Name: inbox_recipients inbox_recipients_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.inbox_recipients
    ADD CONSTRAINT inbox_recipients_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: reschedule_requests reschedule_requests_requested_trainer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reschedule_requests
    ADD CONSTRAINT reschedule_requests_requested_trainer_id_fkey FOREIGN KEY (requested_trainer_id) REFERENCES public.trainers(id);


--
-- Name: reschedule_requests reschedule_requests_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reschedule_requests
    ADD CONSTRAINT reschedule_requests_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.sessions(id) ON DELETE CASCADE;


--
-- Name: reschedule_requests reschedule_requests_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reschedule_requests
    ADD CONSTRAINT reschedule_requests_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: trainer_access trainer_access_trainer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trainer_access
    ADD CONSTRAINT trainer_access_trainer_id_fkey FOREIGN KEY (trainer_id) REFERENCES public.trainers(id);


--
-- Name: trainer_availability trainer_availability_trainer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trainer_availability
    ADD CONSTRAINT trainer_availability_trainer_id_fkey FOREIGN KEY (trainer_id) REFERENCES public.trainers(id);


--
-- Name: trial_sessions trial_sessions_trainer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.trial_sessions
    ADD CONSTRAINT trial_sessions_trainer_id_fkey FOREIGN KEY (trainer_id) REFERENCES public.trainers(id);


--
-- Name: user_plans user_plans_trainer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_plans
    ADD CONSTRAINT user_plans_trainer_id_fkey FOREIGN KEY (trainer_id) REFERENCES public.trainers(id);


--
-- PostgreSQL database dump complete
--

\unrestrict Mbor7GyAlK5EhmW9o6aUuYkYDY9gjcZkTn93GSodfzZowep2bSfh8hhBPSVIKbA

