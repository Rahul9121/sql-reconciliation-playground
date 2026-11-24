PYTHON ?= python
PORT ?= 8000

.PHONY: data test serve install

install:
	$(PYTHON) -m pip install -r requirements.txt

data:
	$(PYTHON) scripts/generate_data.py

test: data
	$(PYTHON) tests/test_challenges.py

serve:
	$(PYTHON) -m http.server $(PORT)
