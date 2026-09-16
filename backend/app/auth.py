import os
import hashlib
import binascii
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import Depends, HTTPException, Security
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
import jwt
from jwt.exceptions import PyJWTError

from . import models
from .database import SessionLocal

# Settings – in production use env vars (min 32 bytes for HS256)
SECRET_KEY = os.getenv("SECRET_KEY", "nextech_super_secret_jwt_key_2026_production_safe_32_bytes")
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 60

security = HTTPBearer()

def get_password_hash(password: str) -> str:
    """Genera un hash seguro usando PBKDF2-HMAC-SHA256 con salt aleatorio."""
    salt = os.urandom(16)
    pwd_hash = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, 100000)
    return f"{binascii.hexlify(salt).decode()}:{binascii.hexlify(pwd_hash).decode()}"

def verify_password(plain_password: str, hashed_password: str) -> bool:
    """Verifica si la contrasena coincide con el hash almacenado."""
    try:
        salt_hex, hash_hex = hashed_password.split(":")
        salt = binascii.unhexlify(salt_hex)
        expected_hash = binascii.unhexlify(hash_hex)
        new_hash = hashlib.pbkdf2_hmac("sha256", plain_password.encode("utf-8"), salt, 100000)
        return hashlib.sha256(new_hash).digest() == hashlib.sha256(expected_hash).digest()
    except Exception:
        return False

def create_access_token(data: dict, expires_delta: Optional[timedelta] = None) -> str:
    """Crea un token JWT con tiempo de expiracion."""
    to_encode = data.copy()
    # Ensure subject is string according to RFC/PyJWT requirement
    if "sub" in to_encode:
        to_encode["sub"] = str(to_encode["sub"])
    expire = datetime.now(timezone.utc) + (expires_delta or timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES))
    to_encode.update({"exp": expire})
    encoded_jwt = jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)
    return encoded_jwt

def get_current_user(credentials: HTTPAuthorizationCredentials = Security(security)) -> models.Usuario:
    """Obtiene el usuario autenticado a partir del token Bearer."""
    token = credentials.credentials
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        sub = payload.get("sub")
        if sub is None:
            raise HTTPException(status_code=401, detail="Invalid authentication credentials")
        user_id = int(sub)
        role: str = payload.get("role")
    except PyJWTError:
        raise HTTPException(status_code=401, detail="Invalid token")

    db = SessionLocal()
    user = db.query(models.Usuario).filter(models.Usuario.id == user_id).first()
    db.close()
    if user is None:
        raise HTTPException(status_code=401, detail="User not found")
    # Attach role for convenience
    setattr(user, "role", role)
    return user

def require_role(required_role: str):
    """Dependencia que valida que el usuario tenga el rol requerido."""
    def role_dependency(user: models.Usuario = Depends(get_current_user)):
        if getattr(user, "role", None) != required_role:
            raise HTTPException(status_code=403, detail="Forbidden: insufficient role")
        return user
    return role_dependency
