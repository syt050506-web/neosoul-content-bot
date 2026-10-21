# NeoSoul Pulse Privacy Policy

Last updated: 21 October 2026

This policy describes data handling for Discord application **NeoSoul Content Bot**, application ID **1529862783976341556**, currently operating as **NeoSoul Pulse** in the **NeoSoul_Official** community. The community operator administers the service. The operator's current Discord contact is **syt050506**. The separate NeoSoul Wallet application is a different application and is outside this policy's scope.

## Information processed

The current Pulse service receives message events in its configured Discord community. It temporarily processes message text to determine whether a contribution qualifies for the community's check-in program. Only accepted activity in administrator-configured participation channels is persisted as check-in activity.

Stored records include:

- Discord user and guild IDs, usernames, accepted message IDs, dates and timestamps.
- SHA-256 fingerprints of normalized accepted message text, used for per-member duplicate detection.
- Daily progress, completed check-in dates and information used to calculate streaks and milestone roles.
- Participating channel IDs and configured milestone role IDs.
- Notification and role-delivery state used for reliable retries.
- Administrator correction audit records, including the administrator ID, affected member, date, reason and time.

The current Pulse database does not store full chat message bodies. Text fingerprints are derived from message content and are not presented as anonymous data. The service does not track online presence, process private-message content for check-ins, or use message data for machine-learning or AI-model training.

## Purposes

The service uses these records to count daily participation, prevent repeated text or message replays from counting repeatedly, calculate progress and streaks, assign milestone roles, deliver private notifications, provide private member queries, support administrator reports and investigate verified service failures.

## Storage and access

Records are stored outside Discord in a private SQLite database on the operator's DigitalOcean server. The service uses a dedicated system account and restricted filesystem permissions. Consistent local backups are created daily. These controls do not imply that the data is anonymous or that encryption at rest has been established.

Members receive their own progress through private responses. Configuration, correction and export commands require Discord Administrator permission. Reports are delivered privately to the administrator who requests them. Authorized operators and community administrators may access the records needed to run the program or handle support requests. Exported reports must be handled responsibly by their recipients.

Discord and DigitalOcean process information necessary to provide their respective services under their own terms and privacy policies. The Pulse service does not implement advertising profiles, data sales or AI-model training.

## Retention and historical records

Retention is currently managed by the operator; the current implementation has no automatic expiry period. Check-in history is not automatically reset each month or erased when a member changes their nickname or leaves the community. Backups may retain earlier copies until the operator separately removes them.

Private recovery archives of retired versions of this application have been retained. Depending on the retired feature, these may contain earlier activity/submission records or wallet-binding records. These archives are not used by the active Pulse service to count current participation. Questions about records from earlier versions can be directed to the same operator contact below.

## Choices and requests

The current version has no self-service per-user tracking opt-out or deletion command. Administrator-selected participation channels determine which activity can be counted; this is not represented as a per-user technical opt-out.

For questions or requests concerning access, correction, deletion or participation, contact **syt050506 on Discord** or the **NeoSoul_Official moderation team**. Requests require manual handling and verification that the requester controls the affected Discord account. Processing a request may require changes to records, backups or service configuration; no automatic deletion deadline or existing opt-out feature is claimed here.

Members can open the community at https://discord.com/channels/1482307119498920012 . If a direct message is unavailable, raise the request with the community's administrators through Discord.

## Policy changes

The operator may revise this policy to reflect service or data-handling changes. The date at the top identifies the current version. Discord's own privacy policy separately applies to use of the Discord platform.
