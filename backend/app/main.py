from fastapi import APIRouter, FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .errors import register_error_handlers
from .security import allowed_origins
from .routers import admin, auth, chats, oauth, owner, rooms, verification

app = FastAPI(title="순룸 Sunroom API", version="1")
register_error_handlers(app)

# 계약: 지정된 FE origin만 허용, credentials=true, Content-Type / X-CSRF-Token 허용
origins = allowed_origins()
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PATCH", "DELETE"],
    allow_headers=["Content-Type", "X-CSRF-Token"],
)

api = APIRouter(prefix="/api/v1")
api.include_router(auth.router)
api.include_router(oauth.router)
api.include_router(rooms.router)
api.include_router(owner.router)
api.include_router(verification.router)
api.include_router(admin.router)
api.include_router(chats.router)


@api.get("/health")
def health():
    return {"ok": True}


app.include_router(api)
