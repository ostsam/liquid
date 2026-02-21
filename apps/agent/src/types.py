from typing import List
from pydantic import BaseModel


class ScalarControl(BaseModel):
    id: str
    label: str
    description: str
    default: float  # 0-100


class ToggleControl(BaseModel):
    id: str
    label: str
    description: str
    default: bool


class ControlSchema(BaseModel):
    scalars: List[ScalarControl]
    toggles: List[ToggleControl]
