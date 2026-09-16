from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, EmailStr
from sqlalchemy.orm import Session

from .. import models
from ..database import get_db
from ..auth import get_password_hash, verify_password, create_access_token

router = APIRouter(prefix="/api/auth", tags=["Auth"]) 

class RegisterRequest(BaseModel):
    nombre: str
    apellido: str
    telefono: str
    email: EmailStr
    password: str
    rol: str  # "cliente" or "empleado"

@router.post("/register", status_code=status.HTTP_201_CREATED)
def register_user(req: RegisterRequest, db: Session = Depends(get_db)):
    # Validate role
    role_obj = db.query(models.Rol).filter(models.Rol.nombre == req.rol).first()
    if not role_obj:
        raise HTTPException(status_code=400, detail="Invalid role")
    # Ensure email uniqueness
    if db.query(models.Usuario).filter(models.Usuario.email == req.email).first():
        raise HTTPException(status_code=400, detail="Email already registered")
    hashed = get_password_hash(req.password)
    user = models.Usuario(
        nombre=req.nombre,
        apellido=req.apellido,
        telefono=req.telefono,
        email=req.email,
        password_hash=hashed,
        rol_id=role_obj.id,
    )
    db.add(user)
    db.commit()
    return {"msg": "User created"}

class LoginRequest(BaseModel):
    email: EmailStr
    password: str

@router.post("/login")
def login(req: LoginRequest, db: Session = Depends(get_db)):
    user = db.query(models.Usuario).filter(models.Usuario.email == req.email).first()
    if not user or not verify_password(req.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Invalid credentials")
    role = db.query(models.Rol).filter(models.Rol.id == user.rol_id).first().nombre
    access_token = create_access_token({"sub": user.id, "role": role, "nombre": user.nombre, "email": user.email})
    return {"access_token": access_token, "role": role, "nombre": user.nombre}
