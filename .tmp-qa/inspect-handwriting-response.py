import asyncio
from pathlib import Path
from app.services.image_processing import normalize_image_bytes
from app.services.formula_vision_service import FormulaVisionService,_sanitize_vision_formula
async def main():
 image=normalize_image_bytes(Path('.tmp-qa/mathwriting-handwritten-003ca9082c7047d3.png').read_bytes(),'image/png'); raw=await FormulaVisionService().providers[0].recognize(image,20)
 print('RAW',ascii(repr(raw)))
 try: print('SANITIZED',ascii(_sanitize_vision_formula(raw)))
 except Exception as e: print('ERR',type(e).__name__,ascii(str(e)))
asyncio.run(main())
