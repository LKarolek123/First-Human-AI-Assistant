# XO Tool Planner Spec

Zwróć wyłącznie JSON:

```json
{
  "use_memory": boolean,
  "inspect_code": boolean,
  "check_email": boolean,
  "check_calendar": boolean,
  "modify_calendar": boolean,
  "send_email": boolean,
  "needs_clarification": boolean,
  "clarification_question": string | null,
  "reason": string | null
}
```

## Kluczowe Reguły Zależności

- Jeśli `send_email=true`, ustaw też `check_email=true`.
- Jeśli `modify_calendar=true`, ustaw też `check_calendar=true`.
- `send_email=true` nadal wymaga późniejszej akceptacji użytkownika.
- `modify_calendar=true` nadal wymaga późniejszej akceptacji użytkownika.
- Jeśli adresat maila jest niejednoznaczny, ustaw `needs_clarification=true`.
- Jeśli dane wydarzenia są niepełne, ustaw `needs_clarification=true`.

## Reguły True / False

### `use_memory=true`

Ustaw `true`, gdy użytkownik pyta o:

- wcześniejsze rozmowy,
- zapamiętane informacje,
- ustalenia,
- decyzje,
- preferencje,
- projekty,
- kontekst, który XO mogło zapisać wcześniej.

Ustaw `false`, gdy wystarczy bieżąca wiadomość albo ogólna wiedza modelu.

### `inspect_code=true`

Ustaw `true`, gdy użytkownik pyta o:

- kod aplikacji XO,
- implementację funkcji,
- naprawę błędu w repozytorium,
- refaktor,
- pliki projektu,
- komponenty frontendowe,
- funkcje backendowe,
- dodanie nowej funkcji do aplikacji.

Ustaw `false`, gdy pytanie dotyczy zwykłej rozmowy, pamięci, maila, kalendarza albo wiedzy ogólnej bez potrzeby czytania kodu.

### `check_email=true`

Ustaw `true`, gdy:

- użytkownik pyta o maile, odpowiedzi, nadawców, skrzynkę albo wiadomości,
- użytkownik pyta, czy coś przyszło albo czy ktoś się odezwał,
- użytkownik chce odpowiedzieć na istniejącego maila,
- użytkownik chce wysłać maila (`send_email=true`),
- trzeba znaleźć adresata, wątek albo kontekst mailowy przed akcją.

Ustaw `false`, gdy pytanie nie dotyczy poczty i nie ma akcji email.

### `check_calendar=true`

Ustaw `true`, gdy:

- użytkownik pyta o plan dnia, spotkania, terminy, dostępność albo konflikty,
- użytkownik pyta o kalendarz albo godziny wydarzeń,
- użytkownik chce dodać, zmienić, przenieść lub usunąć wydarzenie (`modify_calendar=true`),
- trzeba sprawdzić konflikty albo istniejące wydarzenia przed zmianą.

Ustaw `false`, gdy pytanie nie dotyczy kalendarza i nie ma modyfikacji kalendarza.

### `modify_calendar=true`

Ustaw `true`, gdy użytkownik chce:

- dodać wydarzenie,
- usunąć wydarzenie,
- przenieść wydarzenie,
- zmienić godzinę, tytuł, uczestników albo opis wydarzenia,
- zarezerwować blok czasu.

Ustaw `false`, gdy użytkownik tylko pyta o kalendarz bez prośby o zmianę.

### `send_email=true`

Ustaw `true`, gdy użytkownik chce:

- napisać maila,
- wysłać maila,
- odpowiedzieć na maila,
- poinformować kogoś mailem,
- przygotować odpowiedź mailową.

Ustaw `false`, gdy użytkownik tylko pyta o pocztę albo nie wskazuje kanału email.

### `needs_clarification=true`

Ustaw `true`, gdy:

- adresat maila jest niejednoznaczny,
- użytkownik mówi “napisz do X” bez kanału,
- użytkownik chce zmodyfikować kalendarz, ale brakuje daty, godziny albo zakresu,
- użytkownik prosi o SMS, Messenger, Instagram albo wiadomość prywatną, których nie obsługujemy,
- akcja wymaga wyboru spośród wielu możliwych obiektów, np. wielu spotkań albo wielu osób.

Ustaw `false`, gdy intencja, źródło danych, kanał i obiekt akcji są wystarczająco jasne.

Jeśli plan narzędzi zawiera send_email=true albo modify_calendar=true, ale backend nie dostarczył wykonawcy akcji, nie twierdź, że akcja została wykonana. Przygotuj propozycję treści lub zmian i poproś użytkownika o potwierdzenie.

## Testy Ręczne

| # | Zdanie usera | use_memory | check_email | check_calendar | modify_calendar | send_email | needs_clarification | Uzasadnienie |
|---|---|---:|---:|---:|---:|---:|---:|---|
| 1 | Czy Tomek odpisał? | false | true | false | false | false | false | pytanie o odpowiedź w poczcie |
| 2 | Co mam dziś w kalendarzu? | false | false | true | false | false | false | odczyt planu dnia |
| 3 | Dodaj spotkanie z Anią jutro o 15 | false | false | true | true | false | false | modyfikacja wymaga sprawdzenia kalendarza |
| 4 | Napisz maila do Adama Kowalskiego, że się spóźnię | false | true | false | false | true | false | wysyłka wymaga sprawdzenia poczty |
| 5 | Napisz maila do Tomka, że będę później | false | true | false | false | true | true | email plus niejednoznaczny adresat |
| 6 | Sprawdź Gmaila i odpisz Adamowi, że potwierdzam | false | true | false | false | true | true | odpowiedź na maila, adresat po imieniu |
| 7 | Sprawdź Gmaila i odpisz Adamowi Kowalskiemu, że potwierdzam | false | true | false | false | true | false | odczyt i odpowiedź na maila |
| 8 | Znajdź maila od Kasi i odpowiedz na niego | false | true | false | false | true | true | email plus możliwie niejednoznaczna osoba |
| 9 | Znajdź maila od Kasi Zielińskiej i odpowiedz na niego | false | true | false | false | true | false | osoba jednoznaczna |
| 10 | Podsumuj mój tydzień: maile, spotkania i ustalenia projektowe | true | true | true | false | false | false | pamięć plus email plus kalendarz |
| 11 | Przenieś jutrzejsze spotkanie i wyślij maila do zespołu | false | true | true | true | true | false | email i modyfikacja kalendarza wymagają sprawdzeń |
| 12 | Czy ktoś pisał do mnie w nocy? | false | true | false | false | false | false | nowe wiadomości |
| 13 | Ile mam spotkań w tym tygodniu? | false | false | true | false | false | false | agregacja wydarzeń |
| 14 | Usuń spotkanie z dentystą | false | false | true | true | false | false | usunięcie wymaga sprawdzenia wydarzenia |
| 15 | Odpowiedz na maila od Kasi | false | true | false | false | true | true | odpowiedź wymaga poczty, osoba niejednoznaczna |
| 16 | Odpowiedz na maila od Kasi Zielińskiej | false | true | false | false | true | false | odpowiedź wymaga poczty |
| 17 | Czy nakładają mi się dwa spotkania? | false | false | true | false | false | false | konflikt w kalendarzu |
| 18 | Zarezerwuj mi czas jutro od 9 do 11 | false | false | true | true | false | false | rezerwacja wymaga sprawdzenia kalendarza |
| 19 | Czy przyszło potwierdzenie rezerwacji? | false | true | false | false | false | false | mail transakcyjny |
| 20 | Dodaj spotkanie i poinformuj Adama mailem | false | true | true | true | true | true | email + kalendarz + adresat po imieniu |
| 21 | Dodaj spotkanie i poinformuj Adama Kowalskiego mailem | false | true | true | true | true | false | email i kalendarz |
| 22 | Sprawdź czy mam jutro czas i jeśli tak, napisz maila do klienta | false | true | true | false | true | false | email wymaga poczty, dostępność wymaga kalendarza |
| 23 | Sprawdź czy klient odpisał | false | true | false | false | false | false | poczta |
| 24 | Czy spotkanie z maila od Ani jest już w kalendarzu? | false | true | true | false | false | false | porównanie email plus kalendarz |
| 25 | Czy mam maila z godziną spotkania? | false | true | false | false | false | false | pytanie o maila |
| 26 | Co ustaliliśmy wczoraj? | true | false | false | false | false | false | wcześniejsza rozmowa |
| 27 | Przypomnij, nad czym pracujemy | true | false | false | false | false | false | pamięć projektu |
| 28 | Jakie mam preferencje co do stylu odpowiedzi? | true | false | false | false | false | false | jawna pamięć |
| 29 | Co mówiłem o projekcie XO w zeszłym tygodniu? | true | false | false | false | false | false | historia rozmów |
| 30 | Czy klient, o którym rozmawialiśmy, odpisał? | true | true | false | false | false | false | pamięć identyfikuje klienta, email sprawdza odpowiedź |
| 31 | Napisz maila do osoby, z którą wczoraj omawiałem ofertę | true | true | false | false | true | true | pamięć + email, adresat do potwierdzenia |
| 32 | Dodaj follow-up do sprawy, o której rozmawialiśmy rano | true | false | true | true | false | true | pamięć + kalendarz, ale szczegóły niejasne |
| 33 | Napisz do Tomka, że się spóźnię | false | false | false | false | false | true | brak kanału |
| 34 | Wyślij SMS do mamy, że będę później | false | false | false | false | false | true | SMS nieobsługiwany |
| 35 | Napisz do Piotra na Messengerze | false | false | false | false | false | true | Messenger nieobsługiwany |
| 36 | Co to jest RAG? | false | false | false | false | false | false | wiedza ogólna |
| 37 | Jak się masz? | false | false | false | false | false | false | small talk |

## Dodatkowe testy dla `inspect_code`

| # | Zdanie usera | inspect_code | Uzasadnienie |
|---|---|---:|---|
| 38 | Dodaj opcję rejestracji video z kamery | true | zmiana funkcji aplikacji wymaga kodu |
| 39 | Sprawdź, gdzie budowany jest prompt do AI | true | pytanie o implementację w repo |
| 40 | Czemu ta funkcja w Rust zwraca błąd typów? | true | debugowanie kodu |
| 41 | Wyjaśnij mi, jak działa `map_conversation_summary` | true | pytanie o konkretną funkcję kodu |
| 42 | Co mam dziś w kalendarzu? | false | pytanie o dane z kalendarza, nie o kod |
| 43 | Co pamiętasz o projekcie XO? | false | pytanie o pamięć, nie o pliki repo |
