from schema import Building


def test_valid_building_passes_validation():
    b = Building(id="sea:12345", city="sea", source="King County Assessor")
    b.validate()  # should not raise


def test_bad_city_code_rejected():
    b = Building(id="sea:12345", city="xyz", source="test")
    try:
        b.validate()
    except ValueError:
        return
    raise AssertionError("expected ValueError for unknown city code")


def test_mismatched_id_prefix_rejected():
    b = Building(id="nyc:12345", city="sea", source="test")
    try:
        b.validate()
    except ValueError:
        return
    raise AssertionError("expected ValueError for id/city prefix mismatch")


def test_geojson_properties_omit_nulls_and_include_attrs():
    b = Building(id="sea:1", city="sea", source="test", floors=10, attrs={"pin": "123"})
    props = b.to_geojson_properties()
    assert props["floors"] == 10
    assert "height_m" not in props
    assert props["attrs"] == {"pin": "123"}
