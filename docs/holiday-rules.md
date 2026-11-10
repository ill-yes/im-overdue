# German holiday rules (version 1)

`shared/holidays.ts` supplies a small, deterministic German statutory-holiday
calendar. It uses Gregorian `Temporal.PlainDate` arithmetic; neither host nor app
time zone changes a stored date. Automatic rules begin in 1990. Version 1 is a
fixed snapshot of the rules researched on 28 October 2026; a future legislative
change must use a new rule version rather than silently reinterpret old profiles.

The latest profile effective on or before a date applies, including its first
day. A null region disables automatic holidays. Explicit overrides apply even
without a profile and before 1990: a null name excludes the day; a string replaces
or adds it. Manual names remain identical in both languages. A collision between
two statutory holidays yields one date with both names, separated by ` / `.

Only holidays applying throughout the selected Land are automatic. Bavarian
Assumption Day and Augsburg's Peace Festival, and local Corpus Christi in Saxony
and Thuringia, require manual overrides. Religious observances, protected quiet
days, school holidays, Christmas Eve and New Year's Eve are not added.

## Effective rules and primary references

- The nine common holidays are New Year, Good Friday, Easter Monday, Labour Day,
  Ascension, Whit Monday, German Unity Day and both Christmas holidays. The
  [Hamburg government's state comparison](https://www.hamburg.de/resource/blob/134374/7a4a9de67fd46caec0947c11bf23316d/bsb-feiertage-data.pdf)
  documents the baseline state differences; its older reform/date information
  is superseded by the references below.
- Epiphany: BW/BY throughout the supported period; ST first on 6 January 1993
  following its 22 May 1992 holiday law. Corpus Christi: BW/BY/HE/NW/RP/SL.
  All Saints: BW/BY/NW/RP/SL. Assumption: SL.
  [Bavarian law Art. 1](https://www.gesetze-bayern.de/Content/Document/BayFTG-1)
  distinguishes whole-state and local holidays;
  [BW Interior Ministry](https://im.baden-wuerttemberg.de/de/service/feiertage)
  lists its statutory days;
  [ST official law portal](https://www.landesrecht.sachsen-anhalt.de/bsst/document/jlr-FeiertGSTrahmen)
  provides the state law.
- Reformation Day: eastern Länder subject to the historical limits below, and
  HB/HH/NI/SH from 2018; once nationwide in
  2017. [Hannover's official explanation](https://www.hannover.de/Service/Presse-Medien/Hannover.de/Aktuelles/Gut-zu-wissen/Glossar-Feste-und-Feiertage/Warum-und-wie-Hannover-den-Reformationstag-feiert)
  documents the 2017 and 2018 changes.
- International Women's Day: BE from 2019, MV from 2023.
  [Berlin Senate](https://www.berlin.de/sen/wgp/presse/2022/pressemitteilung.1183243.php),
  [MV Landtag](https://www.landtag-mv.de/aktuelles/artikel/internationaler-frauentag-landtagspraesidentin-birgit-hesse-laedt-mitarbeiterinnen-zum-austausch-ein).
- World Children's Day: TH from 2019.
  [Thuringian Landtag proceedings, 28 February 2019](https://parldok.thueringer-landtag.de/ParlDok/dokument/68539/128_plenarsitzung.pdf).
- Berlin one-offs: Liberation Day, 8 May 2020 and 2025; 75th anniversary of the
  17 June 1953 uprising, 17 June 2028.
  [Berlin official announcement](https://www.berlin.de/aktuelles/9188766-958090-einmaliger-feiertag-am-8-mai-2025.html)
  and [enacted §1](https://gesetze.berlin.de/bsbe/document/jlr-FeiertGBEV9P1/format/xsl).
- Buß- und Bettag: 1990–1994 nationwide, then SN only. The date is the Wednesday
  strictly before 23 November.
  [Bavarian Landtag 13/38](https://www.bayern.landtag.de/www/ElanTextAblage_WP13/Drucksachen/0000000001/13_00038.pdf)
  identifies it as a whole-state holiday before the 1995 removal;
  [NRW's 1989 promulgation](https://recht.nrw.de/system/files/GV_Archiv/4122-xmmgvb8919.pdf)
  includes it;
  [Saxon official historical law](https://www.revosax.sachsen.de/vorschrift/3997.1)
  retains it;
  [Bundestag Research Services](https://www.bundestag.de/resource/blob/632896/25-jahre-pflegeversicherung.pdf)
  documents its abolition outside Saxony.

## Historical scope

The [Unification Treaty explanation](https://www.bundestag.de/dokumente/textarchiv/1990-08-31-einigungsvertrag-202386)
documents 3 October 1990 replacing the former national holidays. On 17 June
1990 only the former western Länder receive automatic credit. Berlin's divided
1990 territory cannot be represented by a single state code, so that date needs
a manual override there.

The [DDR holiday ordinance of 16 May 1990](https://www.gesetze-im-internet.de/feiertev/FeiertEV.pdf)
and its [implementing rules](https://www.gesetze-im-internet.de/feiertevdbest_1/FeiertEVDBest_1.pdf)
initially distinguished religious territories. The subsequent
[§168(2) AGB DDR](https://www.gesetze-im-internet.de/agb_ddr/__168.html)
explicitly listed Easter Sunday, Whit Sunday and Bußtag. State-law transitions
must be respected; present-day calendars alone are not historical evidence.

| Land | Inherited Sunday holidays | First evidenced whole-state Reformation |
| --- | --- | --- |
| BB | Both retained | 1991 |
| MV | Both through 1992 | 1992 |
| SN | Both through 1992 | 1993 |
| ST | Both through 1991; Easter also in 1992 | 1992 |
| TH | Both through 1994 | 1995 |

SN's [original statute](https://www.revosax.sachsen.de/vorschrift/3997.1)
took effect on 21 November 1992, after that year's Reformation Day. TH's
[original gazette, pp. 1221–1224](https://parldok.thueringer-landtag.de/ParlDok/dokument/11487/gesetz-und-verordnungsblatt-nr-35-1994.pdf)
repealed the inherited provisions from 1 January 1995. BB's
[statute](https://bravors.brandenburg.de/gesetze/ftg_2015) retained both Sundays.
MV's [official parliamentary report](https://www.dokumentation.landtag-mv.de/parldok/dokument/3458/gesetz_ueber_sonn_und_feiertage_feiertagsgesetz_mecklenburg_vorpommern_ftg_m_v.pdf)
still describes inherited DDR law in May 1992; its subsequent law replaces that
catalogue. The 11 July 1992 commencement date was found in the
[republication metadata](https://www.anwalt24.de/gesetze/ftg_m_v); the original
gazette was not retrieved.

Two limits require explicit attention for historical use: pre-statute eastern
Reformation holidays depended on territorial declarations not retrieved in this
research, so they are not automatically inferred. ST's exact commencement date
for its 22 May 1992 statute also remains unverified: **Whit Sunday, 7 June 1992,
is deliberately not inferred and needs a manual override if applicable.** Its
Easter Sunday precedes that law and is included. These are evidence limits, not
claims that no local holiday existed. The term “Bußtag” in the inherited AGB is
interpreted as Buß- und Bettag, consistent with the statutory succession and
the cited historical accounts.

For Saxony-Anhalt on 7 June 1992, the calendar marks the unresolved status.
Settings also shows a notice with a direct action to prepare a manual date
override. No override is saved automatically; explicitly adding or excluding
the date resolves the notice.

The test suite checks every state's current calendar, historical introduction
boundaries, Easter offsets, collisions, exact overrides/profile boundaries and
purity. Run the same file under distinct `TZ` settings to verify independence.
