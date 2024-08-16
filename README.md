# SW Coast Path

![Picture of the website](images/demo.png)

A small website designed to document the progress of myself, my dad, and my brother around the South West Coast Path. [View it live here](https://projects.ollybritton.com/swcp).

## Datapoints
Data is manually wrangled into the following object, through a [Google Sheet](https://docs.google.com/spreadsheets/d/10E8o0ktfe1anSCR7FRXMTvl35Ae5ixQi1FFj5XI_Em4/edit?gid=0#gid=0) (private).
```js
{
    start: "",
    end: "",
    direction: "N/S",
    startCoords: [],
    endCoords: [],
    charlie: ,
    dad: ,
    olly: ,
    videoLink: "", // https://youtu.be link 
    fixEnd: true // Set this if a marker not already there (e.g., at the end of a N/S stretch or when discontinuous)
}
```