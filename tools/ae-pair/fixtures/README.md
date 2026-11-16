# Pattern Overlay fixture

`pattern.psd` is original synthetic test artwork: a white 256 x 256 layer named
`Pattern`, with a 16 x 16 white/blue checker tile in an editable Pattern Overlay.
Blue is RGB (20, 40, 180). It was generated in Photoshop Beta for this test suite;
it contains no third-party artwork. Photoshop is not required to run the tests.

The harness imports it as a composition named `PatternStyles` before copying the
baseline AEP to the second AE host. Both projects therefore contain the pattern
artwork before collaboration starts. Scenarios edit controls/keyframes in an
unopened comp, upsert the existing layer, and compare rendered pixels across AE
versions. These tests do not claim transfer of new pattern artwork over the relay.

The native hidden-flag research exposed an empty Pattern Overlay on a blank solid,
but its render stayed unchanged. Exposing controls does not supply pattern pixels;
that diagnostic command is deliberately absent from the product companion.
