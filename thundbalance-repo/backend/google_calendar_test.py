from google.oauth2 import service_account
from googleapiclient.discovery import build

SCOPES = [
    "https://www.googleapis.com/auth/calendar"
]

SERVICE_ACCOUNT_FILE = "credentials.json"

CALENDAR_ID = "5b958f681e0f3a7ab9316d1955367098481d33c5682578df1fca743a260d0490@group.calendar.google.com"

credentials = service_account.Credentials.from_service_account_file(
    SERVICE_ACCOUNT_FILE,
    scopes=SCOPES
)

service = build(
    "calendar",
    "v3",
    credentials=credentials
)

event = {

    "summary": "TEST SESSION",

    "description": "Created from FastAPI",

    "start": {
        "dateTime": "2026-06-20T18:00:00",
        "timeZone": "Europe/Madrid"
    },

    "end": {
        "dateTime": "2026-06-20T19:00:00",
        "timeZone": "Europe/Madrid"
    }

}

created_event = service.events().insert(
    calendarId=CALENDAR_ID,
    body=event
).execute()

print(created_event["id"])