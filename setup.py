from setuptools import setup, find_packages
import ast
import os

# Manually parse requirements.txt
def parse_requirements(filename):
    with open(filename, "r") as f:
        lines = f.readlines()
    # Remove comments and whitespace
    return [
        line.strip().split("#")[0].strip()
        for line in lines
        if line.strip() and not line.startswith("#")
    ]

# Parse requirements
requirements = parse_requirements("requirements.txt")

# Read version from __version__ variable in __init__.py
version = {}
with open("pivot_table/__version__.py") as fp:
    exec(fp.read(), version)

setup(
    name="pivot_table",
    version=version["__version__"],
    author="jamunachi",
    author_email="jamunachi007@gmail.com",
    description="Pivot Table App for Frappe",
    packages=find_packages(),
    package_data={"pivot_table": ["public/*"]},
    include_package_data=True,
    install_requires=requirements,
    zip_safe=False,
)
